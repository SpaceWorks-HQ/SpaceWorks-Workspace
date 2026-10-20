import "server-only";
import { type DbClient, prisma } from "@/lib/db";
import { DocumentsError } from "./access";
import { parseDocumentAmount } from "./rules";
export type NoteAllocation = {
  invoiceId: string;
  number: string;
  date: string;
  amountMinor: number;
};
function data(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function frozenNoteAllocations(
  snapshot: unknown,
  parentId: string | null,
  totalMinor: number,
): NoteAllocation[] {
  const source = data(data(snapshot).source),
    rows = source.noteAllocations;
  return Array.isArray(rows)
    ? rows.map((row) => {
        const r = data(row);
        return {
          invoiceId: String(r.invoiceId),
          number: String(r.number),
          date: String(r.date),
          amountMinor: Number(r.amountMinor),
        };
      })
    : parentId
      ? [{ invoiceId: parentId, number: "", date: "", amountMinor: totalMinor }]
      : [];
}
export async function creditsByInvoice(
  workspaceId: string,
  tx: DbClient = prisma,
) {
  const rows = await tx.businessDocument.findMany({
    where: { workspaceId, status: "ISSUED", type: "CREDIT_NOTE" },
    select: { snapshot: true, parentId: true, totalMinor: true },
    take: 10001,
  });
  if (rows.length > 10000)
    throw new DocumentsError(
      "Narrow this workspace's credit-note register before calculating balances.",
    );
  const totals = new Map<string, number>();
  for (const row of rows)
    for (const allocation of frozenNoteAllocations(
      row.snapshot,
      row.parentId,
      row.totalMinor,
    ))
      totals.set(
        allocation.invoiceId,
        (totals.get(allocation.invoiceId) ?? 0) + allocation.amountMinor,
      );
  return totals;
}
export async function resolveNoteAllocations(
  workspaceId: string,
  text: string,
  currency: string,
  parentId: string,
  totalMinor: number,
  tx: DbClient,
) {
  if (!text.trim()) {
    if (!parentId)
      throw new DocumentsError(
        "Choose an original invoice or enter invoice allocations.",
      );
    const row = await tx.businessDocument.findFirst({
      where: {
        workspaceId,
        id: parentId,
        status: "ISSUED",
        currency,
        type: {
          in: [
            "TAX_INVOICE",
            "BILL_OF_SUPPLY",
            "COMMERCIAL_INVOICE",
            "VAT_INVOICE",
            "DEBIT_NOTE",
          ],
        },
        OR: [{ sourceType: null }, { sourceType: { not: "PAY_RUN" } }],
      },
    });
    if (!row)
      throw new DocumentsError("Choose an issued original in this currency.");
    return [
      {
        invoiceId: row.id,
        number: row.number!,
        date: row.issuedOn.toISOString().slice(0, 10),
        amountMinor: totalMinor,
      },
    ];
  }
  const inputs = text.split(/\r?\n/).filter((line) => line.trim());
  if (inputs.length > 50)
    throw new DocumentsError(
      "Keep at most fifty original invoices on one note.",
    );
  const result: NoteAllocation[] = [],
    seen = new Set<string>();
  for (const line of inputs) {
    const [number, amount, ...extra] = line.split("|").map((s) => s.trim()),
      minor = parseDocumentAmount(amount ?? "", currency);
    if (extra.length || !number || minor === null || minor <= 0)
      throw new DocumentsError(
        "Enter one invoice number and adjustment per line, separated by |.",
      );
    const row = await tx.businessDocument.findFirst({
      where: {
        workspaceId,
        number,
        OR: [{ sourceType: null }, { sourceType: { not: "PAY_RUN" } }],
        status: "ISSUED",
        currency,
        type: {
          in: [
            "TAX_INVOICE",
            "BILL_OF_SUPPLY",
            "COMMERCIAL_INVOICE",
            "VAT_INVOICE",
            "DEBIT_NOTE",
          ],
        },
      },
    });
    if (!row || seen.has(row.id))
      throw new DocumentsError(
        "Choose distinct issued invoices in this workspace and currency.",
      );
    seen.add(row.id);
    result.push({
      invoiceId: row.id,
      number: row.number!,
      date: row.issuedOn.toISOString().slice(0, 10),
      amountMinor: minor,
    });
  }
  if (result.reduce((n, a) => n + a.amountMinor, 0) !== totalMinor)
    throw new DocumentsError(
      "Original-invoice allocations must add up to the note total.",
    );
  return result;
}
