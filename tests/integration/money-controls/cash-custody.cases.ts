import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { controlRecord } from "@/lib/moneyControls/access";
import { listControls } from "@/lib/moneyControls/queries";
import { decide } from "@/lib/approvals/engine";
import { actor, admin, member, other, cash, bank, save, transition, attach } from "./fixtures";

export function registerCashCustodyTests() {
  it("requires cash-count difference explanations and freezes the counted facts", async () => {
    const id = await save("COUNT", {
      accountId: cash,
      details: { denominations: "500=1" },
    });
    await expect(transition(id)).rejects.toThrow(/difference/);
    await save("COUNT", {
      id,
      accountId: cash,
      details: { denominations: "500=1" },
      notes: "Cash was recounted; accountant review pending.",
    });
    await transition(id);
    const r = await controlRecord(actor, id);
    expect(r.amountMinor).toBe(50000);
    expect((r.details as { differenceMinor: number }).differenceMinor).not.toBe(
      0,
    );
    await expect(
      save("COUNT", {
        id,
        accountId: cash,
        details: { denominations: "500=2" },
      }),
    ).rejects.toThrow(/confirmed/);
  });
  it("uses the existing approvals engine before replenishing cash", async () => {
    const id = await save("REPLENISHMENT", {
      accountId: cash,
      otherAccountId: bank,
      amountMinor: 20000,
      details: { reference: "Top-up" },
    });
    await attach(id);
    await transition(id, "REQUEST");
    await expect(transition(id)).rejects.toThrow(/Approve/);
    const approval = await prisma.approvalRequest.findFirstOrThrow({
      where: {
        workspaceId: actor.workspace.id,
        subjectType: "CUSTOM",
        subjectId: id,
      },
    });
    const review = await decide(admin, {
      requestId: approval.id,
      decision: "APPROVED",
    });
    expect(review.ok).toBe(true);
    await transition(id);
    expect(
      await prisma.moneyControlMovement.count({
        where: { workspaceId: actor.workspace.id, recordId: id },
      }),
    ).toBe(2);
  });
  it("requires both custodians to sign and scopes personal handovers", async () => {
    const id = await save("HANDOVER", {
      accountId: cash,
      ownerId: member.user.id,
      amountMinor: 1000,
    });
    await expect(transition(id, "SIGN_IN", {}, member)).rejects.toThrow();
    await expect(controlRecord(other, id)).rejects.toThrow();
    await transition(id, "SIGN_OUT", {
      notes: "Difference explained in the cash count.",
    });
    await transition(id, "SIGN_IN", {}, member);
    expect(
      (
        await prisma.moneyControlRecord.findFirstOrThrow({
          where: {
            workspaceId: actor.workspace.id,
            kind: "FLOAT",
            accountId: cash,
          },
        })
      ).ownerId,
    ).toBe(member.user.id);
    expect(
      (await listControls(member, { section: "cash" })).rows.every(
        (r) => r.kind === "HANDOVER",
      ),
    ).toBe(true);
  });
}
