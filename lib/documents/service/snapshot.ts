import "server-only";
import { type DbClient } from "@/lib/db";
import { DocumentsError, getDocument, type DocumentsActor } from "../access";
import { creditsByInvoice, resolveNoteAllocations } from "../corrections";
import { planRefund } from "../refunds";
import {
  calculate,
  draftSchema,
  LETTERS,
  mergeLetter,
  RECEIPTS,
  type DraftInput,
} from "../rules";
import { getSettings } from "./settings";

import { validateSnapshotPayments } from "./snapshot-payment-validation";
import { validateSnapshotRegistration } from "./snapshot-registration";
import { validateSnapshotSources } from "./snapshot-source-validation";
import { freezeSnapshotSources } from "./snapshot-sources";
import { validateSnapshotStatutoryFacts } from "./snapshot-statutory-validation";
import type { DocumentSnapshot } from "../service";

export async function freeze(
  actor: DocumentsActor,
  v: DraftInput,
  tx: DbClient,
): Promise<Omit<DocumentSnapshot, "number">> {
  const settings = await getSettings(actor, tx);
  const { details, profile } = settings;
  if (
    v.irnRequired &&
    !["TAX_INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type)
  )
    throw new DocumentsError(
      "Reserve IRP evidence only for an eligible invoice or tax note.",
    );
  const { fundingSource, fundId } = await validateSnapshotSources(actor, v, tx);
  const { entity, reference, signatory, registration, gst } =
    validateSnapshotRegistration(v, settings);
  await validateSnapshotPayments(actor, v, tx);
  validateSnapshotStatutoryFacts(
    v,
    profile,
    details,
    registration,
    reference,
    fundId,
  );
  let source = await freezeSnapshotSources(actor, v, tx, fundingSource, fundId);
  for (const l of v.lines)
    if (l.ruleId) {
      const rule = reference(l.ruleId, "ITEM");
      if (
        String(rule.validFrom) > (v.supplyOn || v.issuedOn) ||
        String(rule.validTo) < (v.supplyOn || v.issuedOn)
      )
        throw new DocumentsError(
          "Choose an item rate valid on the supply date.",
        );
    }
  const template = v.templateId ? reference(v.templateId, "TEMPLATE") : {};
  if (template.type && template.type !== v.type)
    throw new DocumentsError("Choose a template for this document type.");
  let letter = "";
  if (LETTERS.includes(v.type)) {
    if (
      !v.reviewed ||
      !v.role ||
      !v.startsOn ||
      (!v.letterBody && !template.body)
    )
      throw new DocumentsError(
        "Review the person's role, engagement dates and letter text.",
      );
    letter = mergeLetter(String(v.letterBody || template.body), {
      person: v.partyName,
      start: v.startsOn,
      end: v.endsOn,
      role: v.role,
      programme: v.programme,
      hours: v.hours,
      signatory: String(signatory.name),
      date: v.issuedOn,
    });
  }
  const mode =
    v.type === "VAT_INVOICE"
      ? "VAT"
      : gst && v.type !== "BILL_OF_SUPPLY"
        ? v.componentOverride ||
          (v.supplyCategory !== "DOMESTIC" ||
          registration.state !== v.placeOfSupply
            ? "INTER"
            : "INTRA")
        : "NONE";
  const noTax = ["EXPORT_WITHOUT_TAX", "SEZ_WITHOUT_TAX"].includes(
    v.supplyCategory,
  );
  const calculation = calculate(
    v.lines,
    noTax ? "NONE" : mode,
    v.currency === "INR" && v.roundRupee,
    v.reverseCharge,
  );
  if (
    !LETTERS.includes(v.type) &&
    !["CSR_UC", "GOVERNMENT_UC"].includes(v.type) &&
    !v.lines.length
  )
    throw new DocumentsError("Add at least one document line.");
  if (
    !LETTERS.includes(v.type) &&
    !v.type.endsWith("_UC") &&
    calculation.totalMinor <= 0 &&
    !(v.type === "US_ACKNOWLEDGEMENT" && v.paymentMode === "IN_KIND")
  )
    throw new DocumentsError("The document total must be greater than zero.");
  if (["CREDIT_NOTE", "DEBIT_NOTE"].includes(v.type)) {
    const allocations = await resolveNoteAllocations(
      actor.workspace.id,
      v.noteAllocations,
      v.currency,
      v.parentId,
      calculation.totalMinor,
      tx,
    );
    const credits = await creditsByInvoice(actor.workspace.id, tx);
    for (const allocation of allocations) {
      const original = await tx.businessDocument.findFirstOrThrow({
        where: { workspaceId: actor.workspace.id, id: allocation.invoiceId },
      });
      const originalInput = draftSchema.parse(original.input);
      if (
        (originalInput.partyTaxId &&
          originalInput.partyTaxId !== v.partyTaxId) ||
        (!originalInput.partyTaxId && originalInput.partyName !== v.partyName)
      )
        throw new DocumentsError(
          "A note must keep the original recipient tax identity.",
        );
      if (
        v.type === "CREDIT_NOTE" &&
        (credits.get(original.id) ?? 0) + allocation.amountMinor >
          original.totalMinor
      )
        throw new DocumentsError(
          "This correction exceeds the original amount.",
        );
    }
    source = { ...source, noteAllocations: allocations };
  }
  if (
    (RECEIPTS.includes(v.type) ||
      ["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(v.type)) &&
    calculation.totalMinor !== v.cashMinor + v.tdsMinor
  )
    throw new DocumentsError(
      "Receipt total must equal actual cash plus withholding, without duplication.",
    );
  if (["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(v.type)) {
    if (calculation.totalMinor !== v.cashMinor)
      throw new DocumentsError(
        "The refund total must equal the actual cash returned.",
      );
    const parent = await getDocument(actor, v.parentId, tx),
      parentInput = draftSchema.parse(parent.input);
    if (
      parent.status !== "ISSUED" ||
      parent.currency !== v.currency ||
      parentInput.partyName !== v.partyName
    )
      throw new DocumentsError(
        "Link the issued receipt for this recipient and currency.",
      );
    source = {
      ...source,
      refundAllocations: await planRefund(
        actor.workspace.id,
        parent.id,
        parentInput.cashMinor,
        v.cashMinor,
        tx,
      ),
    };
  }
  return {
    version: 1,
    templateVersion: String(template.version || "2026.1"),
    input: v,
    identity: { name: entity.title, ...details, documents: undefined },
    profile,
    registration,
    signatory,
    calculation,
    letter,
    source,
  };
}
