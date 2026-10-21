import "server-only";
import { type DbClient } from "@/lib/db";
import { DocumentsError, type DocumentsActor } from "../access";
import {
  financialYear,
  GST_TYPES,
  serialNumber,
  type DraftInput,
} from "../rules";
import { json } from "./shared";
import { freeze } from "./snapshot";

export async function reserveSnapshot(
  actor: DocumentsActor,
  v: DraftInput,
  id: string,
  tx: DbClient,
) {
  const frozen = await freeze(actor, v, tx);
  const fy = financialYear(
    v.issuedOn,
    frozen.profile.country === "IN" ? 4 : frozen.profile.fiscalStartMonth,
  );
  let series = await tx.documentSeries.findUnique({
    where: {
      workspaceId_type_registrationId_financialYear: {
        workspaceId: actor.workspace.id,
        type: v.type,
        registrationId: v.registrationId,
        financialYear: fy,
      },
    },
  });
  if (!series) {
    const { createHash } = await import("node:crypto");
    const prefix =
      String(TYPES_PREFIX[v.type]) +
      (v.registrationId
        ? createHash("sha256")
            .update(v.registrationId)
            .digest("hex")
            .slice(0, 3)
            .toUpperCase()
        : "");
    series = await tx.documentSeries.create({
      data: {
        workspaceId: actor.workspace.id,
        type: v.type,
        registrationId: v.registrationId,
        financialYear: fy,
        prefix,
      },
    });
  }
  if (series.locked)
    throw new DocumentsError(
      "This series is locked. Review the period before issuing.",
    );
  const number = serialNumber(
    series.prefix,
    fy,
    series.nextNumber,
    series.padding,
    frozen.profile.country === "IN" && GST_TYPES.includes(v.type),
  );
  await tx.documentSeries.update({
    where: { id: series.id, workspaceId: actor.workspace.id },
    data: { nextNumber: { increment: 1 } },
  });
  const snapshot = { ...frozen, number };
  await tx.businessDocument.update({
    where: { id, workspaceId: actor.workspace.id },
    data: {
      status: "RESERVED",
      number,
      financialYear: fy,
      snapshot: json(snapshot),
      totalMinor: snapshot.calculation.totalMinor,
    },
  });
  return snapshot;
}
const TYPES_PREFIX: Record<string, string> = {
  COMMERCIAL_INVOICE: "CI",
  TAX_INVOICE: "TI",
  BILL_OF_SUPPLY: "BS",
  RECEIPT_VOUCHER: "RV",
  REFUND_VOUCHER: "RF",
  PAYMENT_VOUCHER: "PV",
  CREDIT_NOTE: "CN",
  DEBIT_NOTE: "DN",
  PAYMENT_RECEIPT: "PR",
  PAYMENT_REFUND: "PF",
  DONATION_RECEIPT: "DR",
  DONATION_CERTIFICATE: "DC",
  FCRA_RECEIPT: "FC",
  CSR_UC: "CU",
  GOVERNMENT_UC: "GU",
  APPOINTMENT: "AP",
  VOLUNTEER: "VL",
  INTERNSHIP: "IN",
  EXPERIENCE: "EX",
  NOC: "NC",
  PARTICIPATION: "PC",
  VAT_INVOICE: "VI",
  US_ACKNOWLEDGEMENT: "US",
  GENERIC_RECEIPT: "GR",
};
