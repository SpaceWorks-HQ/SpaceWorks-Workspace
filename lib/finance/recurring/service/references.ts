import "server-only";
import type { DbClient } from "@/lib/db";
import {
  FinanceError,
  validateTags,
  validateMember,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { scheduleSchema } from "../rules";

export async function references(
  tx: DbClient,
  actor: FinanceActor,
  v: ReturnType<typeof scheduleSchema.parse>,
) {
  const workspaceId = actor.workspace.id;
  if (
    v.kind === "EMI" &&
    (!v.accountId || v.estimated || v.gstPercent || v.tdsPercent)
  )
    throw new FinanceError(
      "EMIs need an account, a fixed cash amount and zero tax rates. Enter principal and interest on each bill.",
    );
  await validateTags(tx, workspaceId, v, v.currency, "EXPENSE");
  await validateMember(tx, workspaceId, v.ownerId);
  if (
    v.contactId &&
    !(await tx.contact.findFirst({
      where: { workspaceId, id: v.contactId, deletedAt: null },
    }))
  )
    throw new FinanceError("Choose a contact in this workspace.");
  if (
    v.organisationId &&
    !(await tx.organisation.findFirst({
      where: { workspaceId, id: v.organisationId, deletedAt: null },
    }))
  )
    throw new FinanceError("Choose an organisation in this workspace.");
  if (
    v.leaseId &&
    (v.kind !== "RENT" ||
      !(await tx.facilityLease.findFirst({
        where: {
          workspaceId,
          id: v.leaseId,
          status: "ACTIVE",
          currency: v.currency,
        },
      })))
  )
    throw new FinanceError("Choose an active lease in this currency.");
  if (
    v.subscriptionId &&
    !(await tx.subscription.findFirst({
      where: {
        workspaceId,
        id: v.subscriptionId,
        currency: v.currency,
        status: "ACTIVE",
      },
    }))
  )
    throw new FinanceError("Choose an active subscription in this currency.");
  if (
    v.insuranceId &&
    (v.kind !== "INSURANCE" ||
      !(await tx.governanceRecord.findFirst({
        where: {
          workspaceId,
          id: v.insuranceId,
          kind: "INSURANCE",
          archivedAt: null,
        },
      })))
  )
    throw new FinanceError("Choose an insurance register entry.");
  if (v.depositId) {
    const deposit = await tx.moneyControlRecord.findFirst({
      where: {
        workspaceId,
        id: v.depositId,
        kind: "DEPOSIT",
        payroll: false,
        currency: v.currency,
      },
    });
    if (
      !deposit ||
      (deposit.details as Record<string, unknown>).direction !== "GIVEN"
    )
      throw new FinanceError(
        "Choose a deposit given by this workspace in Money controls.",
      );
  }
}
