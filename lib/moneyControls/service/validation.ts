import "server-only";
import type { MoneyControlRecord } from "@prisma/client";
import type { DbClient } from "@/lib/db";
import { FinanceError, validateMember, validateTags } from "@/lib/finance/tools/access";
import { controlRecord, type ControlsActor } from "../access";
import type { recordSchema } from "../rules";

export function required(value: unknown, message: string): asserts value {
  if (!value) throw new FinanceError(message);
}
export async function proof(tx: DbClient, row: MoneyControlRecord, pdf = false) {
  required(
    await tx.moneyControlAttachment.findFirst({
      where: {
        workspaceId: row.workspaceId,
        recordId: row.id,
        file: {
          deletedAt: null,
          ...(pdf ? { contentType: "application/pdf" } : {}),
        },
      },
    }),
    pdf
      ? "Upload the official certificate PDF first."
      : "Attach the receipt or supporting proof first.",
  );
}
export async function checkLinks(
  tx: DbClient,
  actor: ControlsActor,
  v: ReturnType<typeof recordSchema.parse>,
) {
  await validateMember(tx, actor.workspace.id, v.ownerId || null);
  if (v.ownerId)
    required(
      await tx.membership.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          userId: v.ownerId,
          status: "ACTIVE",
          role: { not: "GUEST" },
          user: { disabledAt: null },
        },
      }),
      "Choose an active team member as owner.",
    );
  await validateTags(
    tx,
    actor.workspace.id,
    {
      accountId: v.accountId || null,
      categoryId: v.categoryId || null,
      fundId: v.fundId || null,
    },
    v.currency,
    ["VOUCHER"].includes(v.kind) ? "EXPENSE" : undefined,
  );
  if (v.otherAccountId) {
    required(
      v.otherAccountId !== v.accountId,
      "Choose two different accounts.",
    );
    await validateTags(
      tx,
      actor.workspace.id,
      { accountId: v.otherAccountId },
      v.currency,
    );
  }
  if (v.assetId)
    required(
      await tx.asset.findFirst({
        where: { workspaceId: actor.workspace.id, id: v.assetId },
      }),
      "Choose equipment in this workspace.",
    );
  if (v.parentId) {
    const parent = await controlRecord(actor, v.parentId, false, tx);
    required(
      v.parentId !== v.id && parent.payroll === v.payroll,
      "Choose a matching parent record.",
    );
  }
  if (v.complianceId)
    required(
      await tx.governanceRecord.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: v.complianceId,
          kind: "OBLIGATION",
          archivedAt: null,
        },
      }),
      "Choose an active compliance-calendar obligation.",
    );
  if (v.checklistRunId)
    required(
      await tx.checklistRun.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: v.checklistRunId,
          subjectUserId: v.ownerId,
          kind: { in: ["ONBOARDING", "OFFBOARDING"] },
        },
      }),
      "Choose this person's onboarding or offboarding checklist.",
    );
}
