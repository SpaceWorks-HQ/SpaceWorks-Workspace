import "server-only";
import { type DbClient } from "@/lib/db";
import { DocumentsError, getDocument, type DocumentsActor } from "../access";
import { RECEIPTS, type DraftInput } from "../rules";

export async function validateSnapshotPayments(
  actor: DocumentsActor,
  v: DraftInput,
  tx: DbClient,
) {
  if (
    ["CREDIT_NOTE", "DEBIT_NOTE", "REFUND_VOUCHER", "PAYMENT_REFUND"].includes(
      v.type,
    ) &&
    !v.parentId &&
    !(
      ["CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type) && v.noteAllocations.trim()
    )
  )
    throw new DocumentsError("Link the original document before issue.");
  if (["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(v.type)) {
    const parent = await getDocument(actor, v.parentId, tx);
    if (
      !RECEIPTS.includes(parent.type) ||
      !v.paymentOn ||
      !v.paymentReference ||
      !v.notes ||
      v.cashMinor <= 0 ||
      v.tdsMinor !== 0
    )
      throw new DocumentsError(
        "Link an issued receipt and record the actual refund date, reference, amount and reason.",
      );
  }
  if (v.type === "REFUND_VOUCHER") {
    const parent = await getDocument(actor, v.parentId, tx);
    if (parent.type !== "RECEIPT_VOUCHER")
      throw new DocumentsError(
        "Refund vouchers require an original advance receipt voucher.",
      );
    if (
      await tx.documentAllocation.findFirst({
        where: { workspaceId: actor.workspace.id, receiptId: parent.id },
      })
    )
      throw new DocumentsError(
        "This advance was allocated. Use a reviewed credit and refund correction.",
      );
  }
  if (["PAYMENT_VOUCHER"].includes(v.type) && !v.reverseCharge)
    throw new DocumentsError(
      "Payment vouchers require reviewed reverse-charge treatment.",
    );
  if (
    RECEIPTS.includes(v.type) &&
    (!v.paymentOn ||
      !v.paymentMode ||
      !v.paymentReference ||
      v.cashMinor + v.tdsMinor === 0)
  )
    throw new DocumentsError(
      "Record payment date, mode, reference and actual cash or withholding.",
    );
  if (v.tdsMinor && !v.tdsSection)
    throw new DocumentsError("Record the withholding section.");
}
