import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  loadMetrics,
  drillRecords,
  context,
  metricResult,
} from "@/lib/analytics/queries";
import { allowedDefinitions } from "@/lib/analytics/definitions";
import { financeReports } from "@/lib/finance/tools/queries";
import { owner, member, admin, outside, records, q, result } from "./fixtures";

export function registerMetricConsistencyTests() {
  it("executes every registered SQL metric against PostgreSQL", async () => {
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: owner.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
    try {
      const c = await context(owner, q),
        errors: string[] = [];
      for (const d of allowedDefinitions(c.access)) {
        try {
          const m = await metricResult(c.access, d, c.q, c.p);
          expect(m.id).toBe(d.id);
        } catch (e) {
          errors.push(`${d.id}: ${String(e)}`);
        }
      }
      expect(errors).toEqual([]);
    } finally {
      await prisma.financePayrollGrant.deleteMany({
        where: { workspaceId: owner.workspace.id },
      });
    }
  }, 60000);
  it("matches Finance report income and expense totals, currency and payroll exclusions", async () => {
    const actor = {
        ...owner,
        user: { ...owner.user, name: null },
        workspace: await prisma.workspace.findUniqueOrThrow({
          where: { id: owner.workspace.id },
        }),
      },
      finance = await financeReports(actor, q);
    expect((await result(owner, "income")).value).toBe(
      finance.entries
        .filter((r) => r.kind === "INCOME")
        .reduce((n, r) => n + r.amountMinor, 0),
    );
    expect((await result(owner, "spending")).value).toBe(10000);
    expect((await result(member, "spending")).value).toBe(10000);
  });
  it("filters each drill-down by workspace and currency", async () => {
    const r = await drillRecords(owner, "income", q);
    expect(r.rows.map((r) => r.title)).toEqual(["Office support"]);
    expect(
      (await drillRecords(outside, "income", q)).rows.map((r) => r.title),
    ).toEqual(["Foreign tenant"]);
    expect((await result(owner, "income")).trend.map((p) => p.label)).toEqual([
      "2026-10-01",
    ]);
    expect(
      (await result(owner, "spending")).groups.find(
        (g) => g.label === "Prior rent",
      ),
    ).toMatchObject({ value: 0, previous: 15000, count: 0 });
    expect(
      (await drillRecords(owner, "spending", { ...q, group: "Prior rent" }))
        .rows,
    ).toEqual([]);
    expect((await result(owner, "payables")).value).toBe(2000);
    expect((await drillRecords(owner, "payables", q)).rows[0].id).toBe(records.billId);
  });
  it("gates confidential requests exactly like Help desk", async () => {
    expect((await result(owner, "help-volume")).count).toBe(1);
    expect((await result(admin, "help-volume")).count).toBe(2);
    expect((await result(member, "help-volume")).count).toBe(1);
    expect(
      (await drillRecords(owner, "help-volume", q)).rows.map((r) => r.title),
    ).toEqual(["Public request"]);
  });
  it("excludes inaccessible dimensions rather than treating them as global", async () => {
    expect(
      (
        await loadMetrics(member, {
          ...q,
          section: "home",
          fund: "not-this-workspace",
        })
      ).metrics.every((m) => m.count === 0),
    ).toBe(true);
  });
}
