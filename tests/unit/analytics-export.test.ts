import { describe, expect, it, vi } from "vitest";
import { GET } from "@/app/w/[workspaceSlug]/analytics/export/route";
import type { DrillData } from "@/lib/analytics/types";

const mocks = vi.hoisted(() => ({ drillRecords: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "viewer" } }) }));
vi.mock("@/lib/permissions", () => ({
  findWorkspaceForUser: async () => ({ workspace: { id: "workspace", currency: "INR" }, membership: { role: "OWNER" } }),
}));
vi.mock("@/lib/actionRateLimit", () => ({ isActionRateLimited: async () => false }));
vi.mock("@/lib/analytics/queries", () => ({ drillRecords: mocks.drillRecords }));
vi.mock("@/lib/analytics/forecast", () => ({}));
vi.mock("@/lib/analytics/service", () => ({}));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: async () => {} }));

describe("analytics drill CSV", () => {
  it.each([
    ["money", "minor units"],
    ["count", "count"],
  ] as const)("labels raw percentage facts with their %s basis", async (basisUnit, expectedUnit) => {
    const drill: DrillData = {
      title: "Ratio", description: "Numerator / denominator", unit: "percent", basisUnit,
      q: { section: "finance", period: "month", currency: "INR", monthlyEmail: false, emailTo: [] },
      period: { from: "2026-09-01", to: "2026-09-21" }, page: 1, more: false,
      rows: [{ id: "fact", date: "2026-09-10", title: "Record", label: "Group", value: 12500, base: 50000, path: "/source" }],
    };
    mocks.drillRecords.mockResolvedValue(drill);
    const response = await GET(new Request("https://example.test/w/workspace/analytics/export?metric=budgets"), {
      params: Promise.resolve({ workspaceSlug: "workspace" }),
    });
    expect(response.status).toBe(200);
    const rows = (await response.text()).split("\r\n");
    expect(rows[2]).toBe('"ID","Date","Record","Group","Value","Denominator","Unit","Link"');
    expect(rows[3]).toBe(`"fact","2026-09-10","Record","Group","12500","50000","${expectedUnit}","/source"`);
  });
});
