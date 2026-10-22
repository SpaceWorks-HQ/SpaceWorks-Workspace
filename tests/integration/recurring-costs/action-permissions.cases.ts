import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  saveSchedule,
} from "@/lib/finance/recurring/service";
import { upcomingView } from "@/lib/finance/recurring/queries";
import { recurringCostAction } from "@/app/actions/recurring-costs";
import { GET as exportCsv } from "@/app/w/[workspaceSlug]/finance/recurring/export/route";
import {
  session,
  slug,
  owner,
  manager,
  person,
  outsider,
  accountId,
  profileId,
  schedule,
  records,
} from "./fixtures";

export function registerActionPermissionTests() {
  it("checks write authority before resolving private profile ids or parsing amounts", async () => {
    session.id = person.user.id;
    const form = (profile: string) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({
        profileId: profile,
        amountMinor: "invalid",
        reason: "Private request",
        requestKey: randomUUID(),
        instalments: "4",
        startsOn: "2026-10-01",
        accountId,
      }))
        f.set(k, v);
      return f;
    };
    const known = await recurringCostAction(slug, "advance", form(profileId));
    const missing = await recurringCostAction(
      slug,
      "advance",
      form("unavailable-profile"),
    );
    expect(known).toMatchObject({ ok: false });
    expect(missing).toEqual(known);
  });
  it("allows an explicit payroll manager without general finance access to manage remittance dates", async () => {
    await prisma.financePayrollGrant.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: person.user.id,
        manage: true,
        grantedById: owner.user.id,
      },
    });
    try {
      session.id = person.user.id;
      const due = await prisma.recurringCostDue.findFirstOrThrow({
        where: { workspaceId: owner.workspace.id, payRunId: records.runId, kind: "PF" },
      });
      const form = new FormData();
      form.set("billId", due.billId);
      form.set("dueOn", "2026-10-28");
      expect(
        await recurringCostAction(slug, "remittanceDue", form),
      ).toMatchObject({ ok: true });
    } finally {
      await prisma.financePayrollGrant.deleteMany({
        where: { workspaceId: owner.workspace.id, userId: person.user.id },
      });
    }
  });
  it("guards action and CSV boundaries for ordinary members and foreign tenants", async () => {
    session.id = person.user.id;
    expect(
      await recurringCostAction(slug, "schedule", new FormData()),
    ).toMatchObject({ ok: false });
    const response = await exportCsv(
      new Request(
        `http://localhost/w/${slug}/finance/recurring/export?export=schedules`,
      ),
      { params: Promise.resolve({ workspaceSlug: slug }) },
    );
    expect(response.status).toBe(404);
    session.id = outsider.user.id;
    const res = await exportCsv(
      new Request(`http://localhost/w/${slug}/finance/recurring/export`),
      { params: Promise.resolve({ workspaceSlug: slug }) },
    );
    expect(res.status).toBe(404);
  });
  it("denies suspended managers and archived workspaces", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: manager.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(saveSchedule(manager, schedule())).rejects.toThrow(/access/);
    await prisma.membership.updateMany({
      where: { workspaceId: owner.workspace.id, userId: manager.user.id },
      data: { status: "ACTIVE" },
    });
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { archivedAt: new Date() },
    });
    await expect(upcomingView(owner)).rejects.toThrow(/access/);
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { archivedAt: null },
    });
  });
}
