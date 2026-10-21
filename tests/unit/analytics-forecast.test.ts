import { beforeEach, describe, it, expect, vi } from "vitest";
import { addMonths } from "@/lib/analytics/metrics";
import { cashForecast } from "@/lib/analytics/forecast";

const db = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  financeBill: { findMany: vi.fn().mockResolvedValue([]), fields: { amountMinor: "amountMinor" } },
  recurringCostSchedule: { findMany: vi.fn().mockResolvedValue([]) },
  recurringCostDue: { findMany: vi.fn().mockResolvedValue([]) },
  fundingRecord: { findMany: vi.fn().mockResolvedValue([]) },
  analyticsAdjustment: { findMany: vi.fn().mockResolvedValue([]) },
  budget: { findMany: vi.fn().mockResolvedValue([]) },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/lib/analytics/queries", () => ({
  context: async () => ({
    access: { admin: true, payroll: false, workspace: { id: "workspace", slug: "workspace", timezone: "Asia/Kolkata" } },
    q: { currency: "INR" },
  }),
}));

describe("approved disbursement cash forecast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$queryRaw.mockResolvedValue([]);
    db.fundingRecord.findMany.mockResolvedValue([]);
    db.recurringCostSchedule.findMany.mockResolvedValue([]);
  });

  it.each([0, 1, 1.5])("keeps the original pledge day after %s paid instalments", async (paid) => {
    db.fundingRecord.findMany.mockResolvedValue([
      { id: "pledge", title: "Monthly support", kind: "PLEDGE", status: "ACTIVE", amountMinor: 1000, currency: "INR",
        details: { nextExpectedOn: "2026-01-31", frequency: "MONTHLY", endOn: "2026-05-31" } },
      ...(paid ? [{ id: "gift", kind: "DONATION", status: "RECEIVED", amountMinor: paid * 1000, currency: "INR",
        details: { pledgeId: "pledge" } }] : []),
    ]);
    const forecast = await cashForecast({
      user: { id: "viewer" }, workspace: { id: "workspace", slug: "workspace", timezone: "Asia/Kolkata" }, membership: { role: "OWNER" },
    }, {}, new Date("2026-01-30T12:00:00Z"));
    expect(forecast.lines.map((line) => line.date)).toEqual(
      ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"].slice(Math.floor(paid)),
    );
    expect(forecast.lines[0].amountMinor).toBe(paid === 1.5 ? 500 : 1000);
  });

  it.each([
    ["MONTHLY", 1, 72], ["QUARTERLY", 3, 24], ["YEARLY", 12, 6],
  ] as const)("aggregates old unpaid %s instalments without losing future receipts", async (frequency, months, overdueCount) => {
    db.fundingRecord.findMany.mockResolvedValue([
      { id: "pledge", title: "Long-running support", kind: "PLEDGE", status: "ACTIVE", amountMinor: 1000, currency: "INR",
        details: { nextExpectedOn: "2020-01-31", frequency } },
      { id: "gift", kind: "DONATION", status: "RECEIVED", amountMinor: 1500, currency: "INR", details: { pledgeId: "pledge" } },
      { id: "other-currency", kind: "DONATION", status: "RECEIVED", amountMinor: 9000, currency: "GBP", details: { pledgeId: "pledge" } },
      { id: "in-kind", kind: "DONATION", status: "RECEIVED", amountMinor: 9000, currency: "INR", details: { pledgeId: "pledge", mode: "IN_KIND" } },
    ]);
    const forecast = await cashForecast({
      user: { id: "viewer" }, workspace: { id: "workspace", slug: "workspace", timezone: "Asia/Kolkata" }, membership: { role: "OWNER" },
    }, {}, new Date("2026-01-30T12:00:00Z"));
    const overdue = forecast.lines.filter((l) => l.id.endsWith(":overdue"));
    expect(overdue).toMatchObject([{ date: "2026-01-31", amountMinor: overdueCount * 1000 - 1500 }]);
    const future = forecast.lines.filter((l) => !l.id.endsWith(":overdue"));
    expect(future.map((l) => l.date)).toEqual(Array.from({ length: Math.ceil(6 / months) }, (_, i) => addMonths("2026-01-31", i * months)));
    expect(future.every((l) => l.amountMinor === 1000)).toBe(true);
    expect(forecast.incomplete).toBe(false);
  });

  it.each([
    ["MONTHLY", "2020-03-31", 1500], ["ONCE", undefined, 500],
  ])("carries the unpaid balance of an ended %s pledge as one overdue line", async (frequency, endOn, amountMinor) => {
    db.fundingRecord.findMany.mockResolvedValue([
      { id: "pledge", title: "Ended support", kind: "PLEDGE", status: "ACTIVE", amountMinor: 1000, currency: "INR",
        details: { nextExpectedOn: "2020-01-31", frequency, endOn } },
      { id: "gift", kind: "DONATION", status: "RECEIVED", amountMinor: frequency === "ONCE" ? 500 : 1500, currency: "INR", details: { pledgeId: "pledge" } },
    ]);
    const forecast = await cashForecast({
      user: { id: "viewer" }, workspace: { id: "workspace", slug: "workspace", timezone: "Asia/Kolkata" }, membership: { role: "OWNER" },
    }, {}, new Date("2026-01-30T12:00:00Z"));
    expect(forecast.lines).toMatchObject([{ id: "pledge:overdue", date: "2026-01-31", amountMinor }]);
    expect(forecast.lines).toHaveLength(1);
  });

  it("flags the forecast incomplete when a recurring projection cap is reached", async () => {
    db.recurringCostSchedule.findMany.mockResolvedValue([
      { id: "old", title: "Old subscription", nextDueOn: new Date("2000-01-31"), frequency: "MONTHLY", dueDay: 31,
        amountMinor: 1000, gstPercent: 0, tdsPercent: 0, kind: "SUBSCRIPTION", _count: { dues: 0 } },
    ]);
    const forecast = await cashForecast({
      user: { id: "viewer" }, workspace: { id: "workspace", slug: "workspace", timezone: "Asia/Kolkata" }, membership: { role: "OWNER" },
    }, {}, new Date("2026-01-30T12:00:00Z"));
    expect(forecast.incomplete).toBe(true);
    expect(forecast.warnings).toContainEqual(expect.stringMatching(/^Forecast incomplete: recurring cost “Old subscription”/));
  });

  it("uses unpaid status and the linked approval's tenant, subject and approved state", async () => {
    db.$queryRaw.mockImplementation(async (sql) => {
      if (sql.sql.includes('FROM "FinanceDisbursement"'))
        return [{ id: "payout", payee: "Approved payout", amountMinor: 12345, dueOn: new Date("2026-10-25") }];
      return [];
    });
    const forecast = await cashForecast({
      user: { id: "viewer" }, workspace: { id: "workspace", slug: "workspace", timezone: "Asia/Kolkata" }, membership: { role: "OWNER" },
    }, {}, new Date("2026-10-21T12:00:00Z"));
    const query = db.$queryRaw.mock.calls.map(([sql]) => sql).find((sql) => sql.sql.includes('FROM "FinanceDisbursement"'));
    expect(query.sql).toContain("r.status<>'PAID'");
    expect(query.sql).not.toContain("r.status='APPROVED'");
    expect(query.sql).toContain('approval.id=r."approvalId"');
    expect(query.sql).toContain('approval."workspaceId"=r."workspaceId"');
    expect(query.sql).toContain('approval."subjectType"=\'CUSTOM\'');
    expect(query.sql).toContain('approval."subjectId"=r.id');
    expect(query.sql).toContain("approval.status='APPROVED'");
    expect(query.values).toContain("workspace");
    expect(query.values).toContain("INR");
    expect(forecast.lines).toMatchObject([{ id: "payout", amountMinor: -12345, date: "2026-10-25", source: "Approved disbursement" }]);
    expect(forecast.lines[0].path).toBe("/w/workspace/finance/disbursements?record=payout#payout");
  });
});
