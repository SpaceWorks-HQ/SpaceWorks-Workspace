import { beforeEach, describe, it, expect, vi } from "vitest";
import { DEFINITIONS, allowedDefinitions, factSql } from "@/lib/analytics/definitions";
import { comparisons, metricValue } from "@/lib/analytics/metrics";
import { metricResult } from "@/lib/analytics/queries";
import type { Access } from "@/lib/analytics/access";

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  meeting: { findMany: vi.fn() },
  team: { findMany: vi.fn() },
  teamMember: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
describe("every analytics metric aggregation contract", () => {
  it("has unique, stable metric identifiers", () => {
    expect(new Set(DEFINITIONS.map((d) => d.id)).size).toBe(DEFINITIONS.length);
  });
  it.each(DEFINITIONS.map((d) => [d.id, d] as const))(
    "%s aggregates numerators and denominators before applying its formula",
    (_id, d) => {
      expect(metricValue(d.mode, 75, 3, 3)).toBe(
        d.mode === "sum" ? 75 : d.mode === "rate" ? 2500 : 25,
      );
      expect(metricValue(d.mode, 0, 0, 0)).toBe(d.mode === "sum" ? 0 : null);
      expect(d.title).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(d.path).toBeTruthy();
      if (d.unit === "money") expect(d.gate).toBeTruthy();
    },
  );
});

describe("analytics source permissions and chart aggregation", () => {
  const access: Access = {
    userId: "viewer", role: "MEMBER", admin: false, finance: true, payroll: false,
    workspace: { id: "workspace", slug: "workspace", name: "Workspace",
      currency: "INR", timezone: "Asia/Kolkata", financeVisibleToMembers: true },
  };
  beforeEach(() => vi.resetAllMocks());

  it.each(["Asia/Kolkata", "America/Los_Angeles"])("dates security incidents by their detection instant in %s", async (timezone) => {
    const sql = await factSql(DEFINITIONS.find((d) => d.id === "security")!,
      { ...access, admin: true, workspace: { ...access.workspace, timezone } }, "2026-10-21");
    expect(sql.sql).toContain("nullif(r.details->>'detectedAt','')::timestamptz AT TIME ZONE 'UTC'");
    expect(sql.sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE ?)::date AS date");
    expect(sql.sql).not.toContain('r."dateOn"');
    expect(sql.values).toContain(timezone);
  });

  it("uses the engagement workflow's end date before the legacy leaving date", async () => {
    const sql = await factSql(DEFINITIONS.find((d) => d.id === "leavers")!, access, "2026-10-21");
    expect(sql.sql).toContain('coalesce(mp."engagementEnd",mp."leavingAt") AS "leavingAt"');
    expect(sql.sql).toContain('r."leavingAt"::date AS date');
    expect(sql.sql).toContain('mp."workspaceId"=mb."workspaceId"');
    expect(sql.values).toContain("workspace");
  });

  it("does not count future SLA deadlines as missed after a later resolution", async () => {
    const sql = await factSql(DEFINITIONS.find((d) => d.id === "help-sla")!, access, "2026-09-21");
    expect(sql.sql).toContain('r."slaDueAt"<=?::timestamp');
    expect(sql.sql).toContain('(r."resolvedAt" IS NULL OR r."resolvedAt">r."slaDueAt")');
    expect(sql.values).toContainEqual(new Date("2026-09-21T18:29:59.999Z"));
  });

  it.each([
    ["Asia/Kolkata", "2026-10-21", "2026-10-21T18:29:59.999Z"],
    ["America/Los_Angeles", "2026-10-21", "2026-10-22T06:59:59.999Z"],
    ["America/New_York", "2026-03-08", "2026-03-09T03:59:59.999Z"],
    ["America/New_York", "2026-11-01", "2026-11-02T04:59:59.999Z"],
  ])("ends SLA observations on the local day in %s on %s", async (timezone, asOf, expected) => {
    const sql = await factSql(DEFINITIONS.find((d) => d.id === "help-sla")!,
      { ...access, workspace: { ...access.workspace, timezone } }, asOf);
    expect(sql.values.filter((v) => v instanceof Date).map((v) => v.toISOString())).toEqual([expected]);
    expect(sql.sql).not.toContain("interval '1 day'");
  });

  it("evaluates each SLA comparison with the same cutoff as its own drill-down", async () => {
    db.$queryRaw.mockResolvedValue([]);
    const d = DEFINITIONS.find((d) => d.id === "help-sla")!;
    const p = { from: "2026-10-01", to: "2026-10-21" };
    const q = { period: "month" };
    await metricResult(access, d, q, p);
    const aggregate = db.$queryRaw.mock.calls[0][0];
    const c = comparisons(p, q.period);
    const cutoffs = [];
    for (const period of [p, c.previous, c.lastYear]) {
      const facts = await factSql(d, access, period.to, false, period, comparisons(period, q.period).previous);
      expect(aggregate.sql).toContain(facts.sql);
      cutoffs.push(...facts.values.filter((v) => v instanceof Date).map((v) => v.toISOString()));
    }
    expect(cutoffs).toHaveLength(3);
    expect(new Set(cutoffs).size).toBe(3);
    expect(aggregate.values.filter((v: unknown) => v instanceof Date).map((v: Date) => v.toISOString())).toEqual(cutoffs);
  });

  it.each([
    { fund: "fund-a" }, { programme: "programme-a" }, { fund: "fund-a", programme: "programme-a" },
  ])("scopes retention donations before cohorting for %j", async (filters) => {
    db.$queryRaw.mockResolvedValue([]);
    await metricResult({ ...access, admin: true }, DEFINITIONS.find((d) => d.id === "retention")!,
      { period: "month", currency: "INR", ...filters }, { from: "2026-10-01", to: "2026-10-21" });
    const sql = db.$queryRaw.mock.calls[0][0];
    const donations = sql.sql.split('GROUP BY r."contactId",r.currency')[0];
    for (const [dimension, id] of Object.entries(filters)) {
      const expression = DEFINITIONS.find((d) => d.id === "retention")!.dimensions![dimension as "fund" | "programme"]!;
      expect(donations).toContain(`(${expression})=`);
      expect(sql.values.filter((v: unknown) => v === id).length).toBeGreaterThanOrEqual(3);
      expect(sql.sql).not.toContain(`NULL::text AS ${dimension}`);
    }
  });

  it("uses local creation dates for snapshot fallback cutoffs", async () => {
    const sql = await factSql(DEFINITIONS.find((d) => d.id === "licences")!, access, "2026-10-21");
    expect(sql.sql).toContain('(r."createdAt" AT TIME ZONE \'UTC\' AT TIME ZONE ?)::date');
    expect(sql.sql).not.toContain('r."createdAt"::date');
    expect(sql.values).toContain("Asia/Kolkata");
  });

  it("reserves safety follow-ups for admins, including reporters", () => {
    expect(allowedDefinitions(access).some((d) => d.id === "safety")).toBe(true);
    expect(allowedDefinitions(access).some((d) => d.id === "safety-followups")).toBe(false);
    expect(allowedDefinitions({ ...access, admin: true }).some((d) => d.id === "safety-followups")).toBe(true);
  });

  it.each(["reach", "engagement"])("links %s to the source account page", async (id) => {
    const sql = await factSql(DEFINITIONS.find((d) => d.id === id)!, access, "2026-10-21");
    expect(sql.sql).toContain("'/social/accounts/'||r.\"accountId\"");
    expect(sql.sql).not.toContain("/social/analytics");
  });

  it.each(["budgets", "campaigns", "grant-utilisation", "bom", "bom-received"])(
    "keeps the %s ratio basis in monetary minor units", (id) => {
      expect(DEFINITIONS.find((d) => d.id === id)).toMatchObject({ unit: "percent", basisUnit: "money" });
    },
  );

  it.each(["releases", "bugs-opened", "bugs-closed", "bom", "bom-received"])(
    "excludes archived projects from %s like Product Ops", async (id) => {
      const sql = await factSql(DEFINITIONS.find((d) => d.id === id)!, { ...access, admin: true }, "2026-10-21");
      expect(sql.sql).toContain('(r."projectId" IS NULL OR p.status<>\'ARCHIVED\')');
    },
  );

  it("restricts certification expiry to current active members like the source loader", async () => {
    const sql = await factSql(DEFINITIONS.find((d) => d.id === "certifications")!, access, "2026-10-21");
    expect(sql.sql).toContain('cert_member."workspaceId"=r."workspaceId"');
    expect(sql.sql).toContain('cert_member."userId"=r."userId"');
    expect(sql.sql).toContain("cert_member.status='ACTIVE'");
  });

  it("uses the meeting source's team-membership and creator predicate", async () => {
    db.teamMember.findMany.mockResolvedValue([{ teamId: "joined-team" }]);
    db.team.findMany.mockResolvedValue([{ id: "hidden-team" }]);
    db.meeting.findMany.mockResolvedValue([{ id: "visible-meeting" }]);
    const sql = await factSql(DEFINITIONS.find((d) => d.id === "meeting-load")!, access, "2026-10-21");
    expect(db.meeting.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "workspace", AND: [
        { OR: [{ teamId: null }, { teamId: { notIn: ["hidden-team"] } }] },
        { OR: [
          { visibility: "WORKSPACE" },
          { visibility: "TEAM", teamId: { in: ["joined-team"] } },
          { createdById: "viewer" },
        ] },
      ] },
      select: { id: true },
    });
    expect(sql.values).toContainEqual(["visible-meeting"]);
    expect(sql.sql).toContain("r.id=ANY(");
  });

  it.each([
    ["2026-10-01", "2026-10-21", "2026-10-20", "2026-10-02"],
    ["2026-01-01", "2026-10-21", "2026-09", "2026-02"],
  ])("sorts trend buckets across categories for %s to %s", async (from, to, later, earlier) => {
    db.$queryRaw.mockResolvedValue([
      { window: 0, label: "A", bucket: later, value: 100, base: 0, count: BigInt(1) },
      { window: 0, label: "Z", bucket: earlier, value: 200, base: 0, count: BigInt(1) },
    ]);
    const m = await metricResult(access, DEFINITIONS.find((d) => d.id === "income")!,
      { period: "custom", from, to }, { from, to });
    expect(m.trend.map((p) => [p.label, p.value])).toEqual([[earlier, 200], [later, 100]]);
  });

  it("keeps the headline and trend win rates while using outcome counts for donut slices", async () => {
    db.$queryRaw.mockResolvedValue([
      { window: 0, label: "DECLINED", bucket: "2026-10-10", value: 0, base: 2, count: BigInt(2) },
      { window: 0, label: "WON", bucket: "2026-10-10", value: 1, base: 1, count: BigInt(1) },
    ]);
    const m = await metricResult(access, DEFINITIONS.find((d) => d.id === "win-rate")!,
      { period: "custom" }, { from: "2026-10-01", to: "2026-10-21" });
    expect(m.value).toBeCloseTo(100 / 3);
    expect(m.trend[0].value).toBeCloseTo(100 / 3);
    expect(m.groups.map((p) => [p.label, p.value])).toEqual([["DECLINED", 2], ["WON", 1]]);
  });
});
