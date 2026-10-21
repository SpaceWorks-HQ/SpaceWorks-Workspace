import "server-only";

import { prisma, type DbClient } from "@/lib/db";
import {
  DocumentsError,
  documentsAccess,
  type DocumentsActor,
} from "../access";
import { type DraftInput } from "../rules";
import { object } from "../service";

export async function fundingDraft(
  actor: DocumentsActor,
  id: string,
  tx: DbClient = prisma,
): Promise<Partial<DraftInput>> {
  await documentsAccess(actor, undefined, tx);
  const source = await tx.fundingRecord.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      id,
      archivedAt: null,
      kind: { in: ["DONATION", "GRANT"] },
    },
  });
  if (!source)
    throw new DocumentsError("Choose a donation or grant in this workspace.");
  if (source.kind === "GRANT") {
    const org = source.organisationId
      ? await tx.organisation.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: source.organisationId,
            deletedAt: null,
          },
        })
      : null;
    return {
      sourceType: "FUNDING",
      sourceId: id,
      type: "CSR_UC",
      title: `Utilisation — ${source.title}`,
      currency: source.currency,
      organisationId: org?.id ?? "",
      partyName: org?.name ?? source.title,
      partyAddress: org?.address ?? "",
      periodStart: source.dateOn?.toISOString().slice(0, 10) ?? "",
      periodEnd: source.endsOn?.toISOString().slice(0, 10) ?? "",
      sanction: source.notes,
    };
  }
  const gift = object(source.details),
    donor = await tx.contact.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        id: source.contactId ?? "",
        deletedAt: null,
      },
    });
  if (!donor) throw new DocumentsError("Choose a current donor contact.");
  const profile = await tx.fundingRecord.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        kind: "DONOR",
        contactId: donor.id,
        archivedAt: null,
      },
    }),
    p = object(profile?.details);
  const emails = Array.isArray(donor.emails) ? donor.emails.map(object) : [];
  return {
    sourceType: "FUNDING",
    sourceId: id,
    type: gift.foreignSource ? "FCRA_RECEIPT" : "DONATION_RECEIPT",
    title: `Donation receipt — ${source.title}`,
    contactId: donor.id,
    currency: source.currency,
    partyName: donor.displayName,
    partyEmail: String(
      emails.find((e) => typeof e.value === "string")?.value ?? "",
    ),
    partyAddress: String(gift.donorAddress || p.address || ""),
    donorIdType: gift.pan || p.pan ? "PAN" : "",
    donorId: String(gift.pan || p.pan || ""),
    paymentOn: source.dateOn?.toISOString().slice(0, 10) ?? "",
    paymentMode: gift.mode as DraftInput["paymentMode"],
    paymentReference: String(
      gift.reference || `Not recorded; funding record ${source.id}`,
    ),
    cashMinor: gift.mode === "IN_KIND" ? 0 : source.amountMinor,
    donationCategory:
      gift.donationType === "CORPUS"
        ? "CORPUS"
        : gift.donationType === "SPECIFIC"
          ? "SPECIFIC_GRANT"
          : "VOLUNTARY",
    notes: String(gift.receiptNote || source.notes || ""),
    lines: [
      {
        description: source.title,
        quantity: "1",
        unitMinor: source.amountMinor,
        discountMinor: 0,
        rateBps: 0,
        cessBps: 0,
        exempt: false,
        exemption: "",
        ruleId: "",
        hsn: "",
        unit: "NOS",
      },
    ],
  };
}
