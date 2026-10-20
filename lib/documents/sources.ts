import "server-only";
import { prisma } from "@/lib/db";
import { parseInvoiceItems } from "@/lib/finance/invoice";
import { localDate } from "@/lib/finance/dates";
import { documentsAccess, DocumentsError, type DocumentsActor } from "./access";
import { draftSchema, TYPES, type DraftInput } from "./rules";
export async function sourceDraft(
  actor: DocumentsActor,
  country: string,
  query: Record<string, string | undefined>,
): Promise<DraftInput> {
  await documentsAccess(actor);
  const sourceType = query.sourceType ?? "",
    sourceId = query.sourceId ?? "";
  const raw: Record<string, unknown> = {
    type:
      TYPES.includes(query.type as (typeof TYPES)[number]) &&
      query.type !== "PAYSLIP"
        ? query.type
        : country === "IN"
          ? "TAX_INVOICE"
          : "GENERIC_RECEIPT",
    title: "New document",
    issuedOn: localDate(new Date(), actor.workspace.timezone),
    currency: actor.workspace.currency,
    partyName: "Recipient",
    sourceType,
    sourceId,
    parentId: query.parentId ?? "",
  };
  const where = { workspaceId: actor.workspace.id, id: sourceId };
  if (sourceType === "INVOICE") {
    const r = await prisma.invoice.findFirst({ where });
    if (!r) throw new DocumentsError("That invoice is unavailable.");
    Object.assign(raw, {
      title: `Document for ${r.number}`,
      currency: r.currency,
      partyName: r.clientName,
      partyEmail: r.clientEmail ?? "",
      dueOn: r.dueOn?.toISOString().slice(0, 10) ?? "",
      lines: parseInvoiceItems(r.items).map((l) => ({
        description: l.description,
        quantity: String(l.quantity),
        unitMinor: l.unitMinor,
        rateBps: l.taxBps ?? 0,
      })),
      notes: `Source legacy invoice ${r.number}. Review classifications before issue.`,
    });
  } else if (sourceType === "LEDGER") {
    const r = await prisma.ledgerEntry.findFirst({
      where: { ...where, privatePayroll: false, voidedAt: null },
    });
    if (!r) throw new DocumentsError("That payment is unavailable.");
    Object.assign(raw, {
      type:
        r.incomeSource === "DONATION" ? "DONATION_RECEIPT" : "PAYMENT_RECEIPT",
      title: r.description,
      currency: r.currency,
      partyName: r.counterparty ?? "Recipient",
      cashMinor: r.amountMinor,
      tdsMinor: r.tdsMinor,
      paymentOn: r.occurredOn.toISOString().slice(0, 10),
      lines: [
        {
          description: r.description,
          quantity: "1",
          unitMinor: r.amountMinor + r.tdsMinor,
          rateBps: 0,
        },
      ],
    });
  } else if (sourceType === "FUND") {
    const r = await prisma.financeFund.findFirst({
      where: { ...where, archivedAt: null },
    });
    if (!r) throw new DocumentsError("That fund is unavailable.");
    Object.assign(raw, {
      type: query.type === "GOVERNMENT_UC" ? "GOVERNMENT_UC" : "CSR_UC",
      title: `Utilisation — ${r.name}`,
      partyName: r.funder ?? "Funding organisation",
      currency: r.currency,
    });
  } else if (sourceType === "FUNDING")
    Object.assign(
      raw,
      await (await import("./funding")).fundingDraft(actor, sourceId),
    );
  else if (sourceType)
    throw new DocumentsError("Choose an available source type.");
  if (query.personId) {
    const r = await prisma.memberProfile.findFirst({
      where: { workspaceId: actor.workspace.id, userId: query.personId },
      include: { user: { select: { name: true } } },
    });
    if (!r) throw new DocumentsError("That person is unavailable.");
    Object.assign(raw, {
      type:
        query.type && TYPES.includes(query.type as (typeof TYPES)[number])
          ? query.type
          : "VOLUNTEER",
      personId: r.userId,
      partyName: r.user.name ?? "Former member",
      startsOn: r.engagementStart?.toISOString().slice(0, 10) ?? "",
      endsOn: r.engagementEnd?.toISOString().slice(0, 10) ?? "",
    });
  }
  if (
    query.type &&
    TYPES.includes(query.type as (typeof TYPES)[number]) &&
    query.type !== "PAYSLIP"
  )
    raw.type = query.type;
  return draftSchema.parse(raw);
}
