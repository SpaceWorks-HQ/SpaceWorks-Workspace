import "server-only";
import { prisma } from "@/lib/db";
import {
  decryptSecret,
  encryptSecret,
} from "@/lib/crypto";
import { toolSchemas } from "@/lib/finance/tools-rules";
import {
  FinanceError,
  auditPayView,
  financeAccess,
  unavailable,
  validateMember,
  validateTags,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { financeNote } from "@/lib/finance/tools/service";
import { recordAuditEvent } from "@/lib/audit";

export async function grantPayroll(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "OWNER");
  const v = toolSchemas.grant.parse(input);
  return prisma.$transaction(async (tx) => {
    await financeAccess(actor, "OWNER", tx);
    await validateMember(tx, actor.workspace.id, v.userId);
    if (v.access === "NONE")
      await tx.financePayrollGrant.deleteMany({
        where: { workspaceId: actor.workspace.id, userId: v.userId },
      });
    else
      await tx.financePayrollGrant.upsert({
        where: {
          workspaceId_userId: {
            workspaceId: actor.workspace.id,
            userId: v.userId,
          },
        },
        create: {
          workspaceId: actor.workspace.id,
          userId: v.userId,
          manage: v.access === "MANAGE",
          grantedById: actor.user.id,
        },
        update: { manage: v.access === "MANAGE", grantedById: actor.user.id },
      });
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "finance.payroll_access_changed",
      targetType: "user",
      targetId: v.userId,
      metadata: { access: v.access },
      client: tx,
    });
    return v.userId;
  });
}
export async function savePayProfile(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "PAY_MANAGE");
  const v = toolSchemas.payProfile.parse(input);
  return prisma.$transaction(async (tx) => {
    await financeAccess(actor, "PAY_MANAGE", tx);
    await validateMember(tx, actor.workspace.id, v.userId);
    await validateTags(tx, actor.workspace.id, v, v.currency);
    const { id, pan, bankLast4, ifsc, clearPan, clearBank, archived, ...rest } =
      v;
    const data = {
      ...rest,
      archivedAt: archived ? new Date() : null,
      ...(pan
        ? { panEnc: encryptSecret("finance-pay-pan", pan) }
        : clearPan
          ? { panEnc: null }
          : {}),
      ...(bankLast4 || ifsc
        ? {
            bankEnc: encryptSecret(
              "finance-pay-bank",
              JSON.stringify({ last4: bankLast4, ifsc }),
            ),
          }
        : clearBank
          ? { bankEnc: null }
          : {}),
    };
    if (id) {
      const row = await tx.financePayProfile.findFirst({
        where: { id, workspaceId: actor.workspace.id },
      });
      if (!row) throw new FinanceError(unavailable);
      if (
        row.currency !== v.currency &&
        (await tx.financePayRun.count({
          where: { workspaceId: actor.workspace.id, profileId: id },
        }))
      )
        throw new FinanceError(
          "This person has pay runs. Keep the profile's currency.",
        );
      await tx.financePayProfile.updateMany({
        where: { id, workspaceId: actor.workspace.id },
        data,
      });
    }
    const rowId =
      id ??
      (
        await tx.financePayProfile.create({
          data: { ...data, workspaceId: actor.workspace.id },
        })
      ).id;
    await financeNote(tx, actor, "pay_profile", rowId, "saved");
    return rowId;
  });
}
export async function revealPayDetails(actor: FinanceActor, profileId: string) {
  await financeAccess(actor, "PAY_VIEW");
  return prisma.$transaction(async (tx) => {
    await financeAccess(actor, "PAY_VIEW", tx);
    const profile = await tx.financePayProfile.findFirst({
      where: { workspaceId: actor.workspace.id, id: profileId },
    });
    if (!profile) throw new FinanceError(unavailable);
    await auditPayView(actor, "pay_profile_details", profile.id, tx);
    return {
      pan: profile.panEnc
        ? decryptSecret("finance-pay-pan", profile.panEnc)
        : "",
      bank: profile.bankEnc
        ? (JSON.parse(decryptSecret("finance-pay-bank", profile.bankEnc)) as {
            last4: string;
            ifsc: string;
          })
        : null,
    };
  });
}
