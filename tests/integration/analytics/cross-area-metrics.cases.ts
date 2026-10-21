import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createUser, addMember } from "../../helpers/fixtures";
import { loadMetrics, drillRecords } from "@/lib/analytics/queries";
import { cashForecast } from "@/lib/analytics/forecast";
import { owner, member, domain, q, result } from "./fixtures";

export function registerCrossAreaMetricTests() {
  it("uses proposal outcome counts for donut slices while retaining the headline win rate", async () => {
    for (const [index, status] of ["WON", "DECLINED", "DECLINED", "SENT", "WITHDRAWN"].entries())
      await prisma.marketingItRecord.create({ data: {
        workspaceId: owner.workspace.id, kind: "PROPOSAL", title: `Win-rate fixture ${index}`,
        status, details: { sentOn: "2026-10-10" }, createdById: owner.user.id,
      } });
    const m = await result(owner, "win-rate");
    expect(m.value).toBeCloseTo(100 / 3);
    expect(m.groups.map((g) => [g.label, g.value])).toEqual([["DECLINED", 2], ["WON", 1]]);
    expect(m.trend[0].value).toBeCloseTo(100 / 3);
    expect(m.groups.reduce((sum, g) => sum + g.value, 0)).toBe(3);
  });

  it("keeps reporters' safety follow-ups admin-only in metrics, drills and CSV", async () => {
    const { getSafety } = await import("@/lib/opsGaps/safety"),
      { csv } = await import("@/lib/analytics/metrics"),
      ws = owner.workspace.id,
      report = await prisma.safetyReport.create({ data: {
        workspaceId: ws, reporterId: member.user.id, title: "Reported hazard",
        description: "Hazard", immediateAction: "Isolated", location: "Workshop",
        kind: "HAZARD", occurredAt: new Date("2026-10-10"), requestKey: "analytics-followup",
        actions: { create: { title: "Private handling action",
          assigneeId: owner.user.id, dueAt: new Date("2026-10-15") } },
      } }),
      sourceActor = { ...member, user: { ...member.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({ where: { id: ws } }) };
    expect((await getSafety(sourceActor, report.id))?.actions).toEqual([]);
    expect((await result(member, "safety")).count).toBeGreaterThan(0);
    expect((await loadMetrics(member, { ...q, section: "operations" })).metrics.some((m) => m.id === "safety-followups")).toBe(false);
    // CSV uses drillRecords too; both paths must reject before exposing rows.
    await expect(drillRecords(member, "safety-followups", q, 10000)).rejects.toThrow("unavailable");
    expect((await result(owner, "safety-followups")).count).toBe(1);
    const drill = await drillRecords(owner, "safety-followups", q);
    expect(csv(drill.rows.map((r) => [r.title, r.date, r.value]))).toContain("Private handling action");
  });

  it("forecasts approved unpaid disbursements using the payment workflow's approval identity", async () => {
    const ws = owner.workspace.id;
    for (const [i, status, approvalStatus, subjectType, mismatched] of [
      [0, "PENDING", "APPROVED", "CUSTOM", false],
      [1, "PENDING", "PENDING", "CUSTOM", false],
      [2, "PENDING", "REJECTED", "CUSTOM", false],
      [3, "PAID", "APPROVED", "CUSTOM", false],
      [4, "DRAFT", "APPROVED", "CUSTOM", true],
      [5, "PENDING", "APPROVED", "PURCHASE_REQUEST", false],
    ] as const) {
      const row = await prisma.financeDisbursement.create({ data: {
        workspaceId: ws, payee: `Forecast payout ${i}`, purpose: "Regression",
        kind: "VENDOR", amountMinor: 1000, currency: "GBP", status,
        dueOn: new Date("2026-10-25"), createdById: owner.user.id,
      } });
      const approval = await prisma.approvalRequest.create({ data: {
        workspaceId: ws, subjectType, subjectId: mismatched ? "different-payout" : row.id,
        title: "Approve payout", requesterId: owner.user.id, steps: [], status: approvalStatus,
      } });
      await prisma.financeDisbursement.update({ where: { id: row.id }, data: { approvalId: approval.id } });
    }
    const forecast = await cashForecast(owner, { currency: "GBP" }, new Date("2026-10-21T12:00:00Z"));
    expect(forecast.lines.filter((l) => l.source === "Approved disbursement").map((l) => [l.title, l.amountMinor]))
      .toEqual([["Forecast payout 0", -1000]]);
  });

  it("matches Product Ops visibility after a project is archived", async () => {
    const { visibleWhere } = await import("@/lib/productOps/access"),
      ws = owner.workspace.id,
      project = await prisma.project.create({ data: { workspaceId: ws, key: "ARCHIVEDPRODUCT", name: "Archived product", status: "ARCHIVED" } });
    const record = await prisma.productRecord.create({ data: {
      workspaceId: ws, kind: "RELEASE", title: "Archived project release", status: "SHIPPED",
      projectId: project.id, createdById: owner.user.id, shippedAt: new Date("2026-10-10"),
    } });
    for (const actor of [owner, member]) {
      expect(await prisma.productRecord.findFirst({ where: { AND: [await visibleWhere(actor), { id: record.id }] } })).toBeNull();
      expect((await drillRecords(actor, "releases", q)).rows.some((r) => r.id === record.id)).toBe(false);
    }
    await prisma.project.update({ where: { id: project.id }, data: { status: "ACTIVE" } });
    expect((await drillRecords(member, "releases", q)).rows.some((r) => r.id === record.id)).toBe(true);
  });

  it("carries the monetary ratio basis from the definition into the drill payload", async () => {
    expect(await drillRecords(owner, "budgets", q)).toMatchObject({ unit: "percent", basisUnit: "money" });
    expect(await drillRecords(member, "attendance", q)).toMatchObject({ unit: "percent", basisUnit: "count" });
  });

  it("hides certification expiry when its holder is no longer an active member", async () => {
    const { certifications } = await import("@/lib/people/certifications"),
      holder = await createUser(`cert-holder${domain}`),
      ws = owner.workspace.id,
      type = await prisma.certType.create({ data: { workspaceId: ws, name: "Analytics sign-off" } }),
      cert = await prisma.certification.create({ data: {
        certTypeId: type.id, userId: holder.id, expiresAt: new Date("2026-10-15"),
      } }),
      actor = { ...owner, user: { ...owner.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({ where: { id: ws } }) };
    await addMember(ws, holder.id, "MEMBER");
    expect((await drillRecords(owner, "certifications", q)).rows.some((r) => r.id === cert.id)).toBe(true);
    await prisma.membership.updateMany({ where: { workspaceId: ws, userId: holder.id }, data: { status: "SUSPENDED" } });
    expect(await certifications(actor, holder.id)).toEqual([]);
    expect((await drillRecords(owner, "certifications", q)).rows.some((r) => r.id === cert.id)).toBe(false);
    await prisma.membership.deleteMany({ where: { workspaceId: ws, userId: holder.id } });
    expect((await drillRecords(owner, "certifications", q)).rows.some((r) => r.id === cert.id)).toBe(false);
  });

  it("counts detection-only security incidents on the workspace-local day", async () => {
    const ws = owner.workspace.id;
    const incident = await prisma.marketingItRecord.create({ data: {
      workspaceId: ws, kind: "INCIDENT", title: "Detection timestamp regression", status: "DETECTED",
      createdById: owner.user.id, details: { detectedAt: "2026-10-20T20:00:00Z", severity: "HIGH" },
    } });
    const onDay = { period: "custom", from: "2026-10-21", to: "2026-10-21" };
    expect((await drillRecords(owner, "security", onDay)).rows).toContainEqual(expect.objectContaining({ id: incident.id, date: "2026-10-21" }));
    expect((await result(owner, "security", onDay)).count).toBeGreaterThanOrEqual(1);
    expect((await drillRecords(owner, "security", { ...onDay, from: "2026-10-20", to: "2026-10-20" })).rows.some((r) => r.id === incident.id)).toBe(false);
    // An unrelated optional register date must not move the incident.
    await prisma.marketingItRecord.update({ where: { id: incident.id }, data: { dateOn: new Date("2026-09-01") } });
    expect((await drillRecords(owner, "security", onDay)).rows.some((r) => r.id === incident.id)).toBe(true);
  });

  it("counts engagement end dates as leavers and preserves the legacy fallback", async () => {
    const ws = owner.workspace.id;
    for (const [name, engagementEnd, leavingAt, date] of [
      ["engagement", "2026-10-15", null, "2026-10-15"],
      ["legacy", null, "2026-10-16", "2026-10-16"],
      ["both", "2026-10-17", "2026-11-01", "2026-10-17"],
    ] as const) {
      const user = await createUser(`${name}${domain}`);
      await addMember(ws, user.id, "MEMBER");
      await prisma.memberProfile.create({ data: { workspaceId: ws, userId: user.id,
        engagementEnd: engagementEnd ? new Date(engagementEnd) : null,
        leavingAt: leavingAt ? new Date(leavingAt) : null,
      } });
      expect((await drillRecords(owner, "leavers", q)).rows).toContainEqual(expect.objectContaining({ date, path: `/w/${owner.workspace.slug}/members/${user.id}` }));
    }
  });
}
