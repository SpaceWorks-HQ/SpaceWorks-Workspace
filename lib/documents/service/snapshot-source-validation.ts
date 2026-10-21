import "server-only";
import { type DbClient } from "@/lib/db";
import { DocumentsError, type DocumentsActor } from "../access";
import { RECEIPTS, type DraftInput } from "../rules";
import { object } from "./shared";

export async function validateSnapshotSources(
  actor: DocumentsActor,
  v: DraftInput,
  tx: DbClient,
) {
  const fundingSource =
    v.sourceType === "FUNDING"
      ? await tx.fundingRecord.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: v.sourceId,
            archivedAt: null,
          },
        })
      : null;
  if (
    fundingSource?.kind === "DONATION" &&
    ["DONATION_RECEIPT", "FCRA_RECEIPT", "DONATION_CERTIFICATE"].includes(
      v.type,
    )
  ) {
    const gift = object(fundingSource.details),
      converted =
        v.type === "DONATION_CERTIFICATE" && fundingSource.currency !== "INR";
    if (
      fundingSource.status !== "RECEIVED" ||
      fundingSource.contactId !== v.contactId ||
      gift.mode !== v.paymentMode ||
      gift.mode === "IN_KIND" ||
      (!converted &&
        (fundingSource.currency !== v.currency ||
          fundingSource.amountMinor !== v.cashMinor)) ||
      (converted &&
        (v.currency !== "INR" ||
          v.inrMinor !== v.cashMinor ||
          !v.exchangeBasis))
    )
      throw new DocumentsError(
        "Match the received gift's donor, mode, currency and amount; retain reviewed INR conversion facts for a foreign-currency certificate.",
      );
    if (gift.foreignSource && v.type === "DONATION_RECEIPT")
      throw new DocumentsError(
        "Use an FCRA receipt and verify its designated account and registration first.",
      );
    if (
      gift.foreignSource &&
      v.type === "DONATION_CERTIFICATE" &&
      !(await tx.businessDocument.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          sourceType: "FUNDING",
          sourceId: fundingSource.id,
          type: "FCRA_RECEIPT",
          status: "ISSUED",
        },
      }))
    )
      throw new DocumentsError(
        "Issue the verified FCRA receipt before reviewing a deduction certificate for this gift.",
      );
  }
  const fundId =
    v.sourceType === "FUND"
      ? v.sourceId
      : fundingSource?.kind === "GRANT"
        ? fundingSource.fundId
        : null;

  if (
    v.sourceType === "LEDGER" &&
    [...RECEIPTS, "DONATION_CERTIFICATE", "PAYMENT_REFUND"].includes(v.type)
  ) {
    const payment = await tx.ledgerEntry.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: v.sourceId,
        privatePayroll: false,
        voidedAt: null,
      },
    });
    if (
      !payment ||
      payment.currency !== v.currency ||
      payment.amountMinor !== v.cashMinor ||
      payment.kind !== (v.type === "PAYMENT_REFUND" ? "EXPENSE" : "INCOME")
    )
      throw new DocumentsError(
        "The receipt or refund cash amount and currency must match its linked ledger payment.",
      );
  }

  return { fundingSource, fundId };
}
