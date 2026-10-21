import { randomUUID } from "node:crypto";
import { INVOICES, ALLOCATABLE_RECEIPTS } from "@/lib/documents/rules";
import type { EditorOptions } from "@/lib/documents/types";
import { formatMoney } from "@/lib/format/money";
import { DocumentForm } from "@/components/documents/DocumentForm";

type Allocation = {
  id: string;
  receipt: { number: string | null };
  invoice: { number: string | null };
  cashMinor: number;
  tdsMinor: number;
};

export function DocumentAllocations({
  workspaceSlug,
  row,
  options,
  allocations,
}: {
  workspaceSlug: string;
  row: { id: string; type: string; currency: string };
  options: EditorOptions;
  allocations: Allocation[];
}) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
      <h2 className="text-h3">Payment allocations</h2>
      <p>
        Allocate cash and TDS separately. This does not create or duplicate
        a ledger payment.
      </p>
      <DocumentForm
        slug={workspaceSlug}
        operation="allocation"
        hidden={{
          currency: row.currency,
          key: randomUUID(),
          ...(INVOICES.includes(row.type)
            ? { invoiceId: row.id }
            : { receiptId: row.id }),
        }}
        fields={[
          {
            name: INVOICES.includes(row.type) ? "receiptId" : "invoiceId",
            label: INVOICES.includes(row.type)
              ? "Issued receipt"
              : "Issued invoice",
            type: "select",
            options: options.originals.filter(
              (o) =>
                o.status === "ISSUED" &&
                (INVOICES.includes(row.type)
                  ? ALLOCATABLE_RECEIPTS.includes(o.type)
                  : INVOICES.includes(o.type)),
            ),
            required: true,
          },
          {
            name: "cashMinor",
            label: `Cash allocation (${row.currency})`,
            type: "money",
            value: 0,
          },
          {
            name: "tdsMinor",
            label: `TDS allocation (${row.currency})`,
            type: "money",
            value: 0,
          },
        ]}
        label="Allocate payment"
      />
      <ul>
        {allocations.map((a) => (
          <li key={a.id} className="py-2">
            {a.receipt.number} → {a.invoice.number}:{" "}
            {formatMoney(a.cashMinor, row.currency)} cash +{" "}
            {formatMoney(a.tdsMinor, row.currency)} TDS
          </li>
        ))}
      </ul>
    </section>
  );
}
