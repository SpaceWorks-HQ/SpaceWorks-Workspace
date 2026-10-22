import "server-only";
import { prisma } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { bankSchema } from "../schemas";
import { type Actor, lock, ensure, assertActor } from "./access";
import { audit } from "./activity";

export async function changeBank(actor: Actor, raw: unknown) {
  const input = bankSchema.parse(raw);
  await prisma.$transaction(async (tx) => {
    await lock(actor, tx);
    const vendor = await tx.governanceRecord.findFirst({
      where: {
        id: input.vendorId,
        workspaceId: actor.workspace.id,
        kind: "VENDOR",
        archivedAt: null,
      },
    });
    ensure(vendor);
    const { vendorId, reason, ...bank } = input;
    await tx.governanceBankChange.create({
      data: {
        workspaceId: actor.workspace.id,
        vendorId,
        actorId: actor.user.id,
        reason,
        bankEnc: encryptSecret("governance-vendor-bank", JSON.stringify(bank)),
      },
    });
    await audit(actor, tx, vendor, "bank_changed");
  });
}
export async function revealBank(actor: Actor, vendorId: string) {
  return prisma.$transaction(async (tx) => {
    await assertActor(actor, tx);
    const vendor = await tx.governanceRecord.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: vendorId,
        kind: "VENDOR",
        archivedAt: null,
      },
    });
    ensure(vendor);
    const bank = await tx.governanceBankChange.findFirst({
      where: { workspaceId: actor.workspace.id, vendorId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    await audit(actor, tx, vendor, "bank_revealed");
    return bank
      ? (JSON.parse(decryptSecret("governance-vendor-bank", bank.bankEnc)) as {
          accountName: string;
          bankName: string;
          accountNumber: string;
          routingCode: string;
        })
      : null;
  });
}
