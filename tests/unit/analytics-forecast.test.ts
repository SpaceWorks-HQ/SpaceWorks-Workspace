import { beforeEach, describe, it, expect, vi } from "vitest";
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
