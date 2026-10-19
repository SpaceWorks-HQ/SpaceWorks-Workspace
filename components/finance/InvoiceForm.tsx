"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { createInvoiceAction, updateInvoiceAction } from "@/app/actions/finance";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/display";
import { Field, Input, PrefixInput, Textarea } from "@/components/ui/field";
import { currencySymbol, invoiceTotals, isNegativeMoney, lineSubtotalMinor, parsePercentToBps, type InvoiceItem } from "@/lib/finance/money";
import { formatMoney, parseMoneyToMinor } from "@/lib/format/money";

export type InvoiceFormLine = { key: string; description: string; quantity: string; unitPrice: string; tax: string };
export type InvoiceFormValues = { clientName: string; clientEmail: string; issuedOn: string; dueOn: string; notes: string; lines: InvoiceFormLine[] };

let counter = 0;
const blankLine = (): InvoiceFormLine => ({ key: `line-${Date.now()}-${counter++}`, description: "", quantity: "1", unitPrice: "", tax: "" });

function toItem(line: InvoiceFormLine, currency: string): InvoiceItem | null {
  const quantity = Number(line.quantity);
  const unitMinor = isNegativeMoney(line.unitPrice) ? null : parseMoneyToMinor(line.unitPrice, currency);
  const taxBps = parsePercentToBps(line.tax);
  if (!Number.isFinite(quantity) || quantity <= 0 || unitMinor === null || taxBps === null) return null;
  return { description: line.description, quantity, unitMinor, ...(taxBps ? { taxBps } : {}) };
}

export function InvoiceForm({ slug, currency, invoiceId, initial, backHref }: { slug: string; currency: string; invoiceId?: string; initial: InvoiceFormValues; backHref: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  const money = (minor: number) => formatMoney(minor, currency);
  const symbol = currencySymbol(currency);
  const set = <K extends keyof InvoiceFormValues>(key: K, value: InvoiceFormValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const setLine = (key: string, patch: Partial<InvoiceFormLine>) => set("lines", values.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const items = values.lines.map((line) => toItem(line, currency));
  const totals = invoiceTotals(items.filter((item): item is InvoiceItem => item !== null));

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        const lineErrors: Record<string, string[]> = {};
        const payloadItems = values.lines.map((line, index) => {
          const taxBps = parsePercentToBps(line.tax);
          if (taxBps === null) lineErrors[`items.${index}.taxBps`] = ["Use a percentage between 0 and 100."];
          return { description: line.description, quantity: Number(line.quantity), unitPrice: line.unitPrice, ...(taxBps ? { taxBps } : {}) };
        });
        if (Object.keys(lineErrors).length) {
          setErrors(lineErrors);
          showToast("Check the tax rates on your lines.", "error");
          return;
        }
        const payload = { clientName: values.clientName, clientEmail: values.clientEmail, issuedOn: values.issuedOn, dueOn: values.dueOn, notes: values.notes, items: payloadItems };
        startTransition(async () => {
          const result = invoiceId ? await updateInvoiceAction(slug, invoiceId, payload) : await createInvoiceAction(slug, payload);
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            showToast(result.error, "error");
            return;
          }
          showToast(invoiceId ? "Invoice saved." : "Invoice created as a draft.", "success");
          const target = invoiceId ?? (result.data as { id: string } | undefined)?.id;
          router.push(target ? `${backHref}/${target}` : backHref);
          router.refresh();
        });
      }}
    >
      <Card padding="lg" as="section">
        <CardHeader title="Client" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client name" required error={errors.clientName?.[0]}>
            <Input value={values.clientName} onChange={(e) => set("clientName", e.target.value)} maxLength={120} placeholder="Kochi Robotics Club" />
          </Field>
          <Field label="Client email" optional helperText="Needed to email the invoice." error={errors.clientEmail?.[0]}>
            <Input type="email" value={values.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} maxLength={254} />
          </Field>
          <Field label="Issued on" required error={errors.issuedOn?.[0]}>
            <Input type="date" value={values.issuedOn} onChange={(e) => set("issuedOn", e.target.value)} />
          </Field>
          <Field label="Due on" optional error={errors.dueOn?.[0]}>
            <Input type="date" value={values.dueOn} min={values.issuedOn || undefined} onChange={(e) => set("dueOn", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card padding="lg" as="section">
        <CardHeader title="Lines" description="Quantity × unit price, with an optional tax rate per line." />
        {errors.items?.[0] ? <p className="mb-3 text-caption text-danger-fg">{errors.items[0]}</p> : null}
        <ol className="flex flex-col gap-4">
          {values.lines.map((line, index) => {
            const item = items[index];
            const err = (field: string) => errors[`items.${index}.${field}`]?.[0];
            return (
              <li key={line.key} className="grid gap-3 border-b border-line pb-4 last:border-b-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_6rem_10rem_6rem_8rem_auto] md:items-end">
                <Field label={`Line ${index + 1}`} error={err("description")}>
                  <Input value={line.description} onChange={(e) => setLine(line.key, { description: e.target.value })} maxLength={200} placeholder="Laser cutter time" />
                </Field>
                <Field label="Qty" error={err("quantity")}>
                  <Input type="number" inputMode="decimal" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setLine(line.key, { quantity: e.target.value })} />
                </Field>
                <Field label="Unit price" error={err("unitPrice")}>
                  <PrefixInput prefix={symbol} inputMode="decimal" value={line.unitPrice} onChange={(e) => setLine(line.key, { unitPrice: e.target.value })} placeholder="0.00" />
                </Field>
                <Field label="Tax %" optional error={err("taxBps")}>
                  <Input inputMode="decimal" value={line.tax} onChange={(e) => setLine(line.key, { tax: e.target.value })} placeholder="0" />
                </Field>
                <div className="flex min-h-11 flex-col justify-center md:items-end">
                  <span className="text-caption text-ink-muted md:sr-only">Line total</span>
                  <span className="text-body-ui font-semibold tabular-nums text-ink">{item ? money(lineSubtotalMinor(item)) : "—"}</span>
                </div>
                <IconButton label={`Remove line ${index + 1}`} onClick={() => set("lines", values.lines.filter((l) => l.key !== line.key))} disabled={values.lines.length === 1}>
                  <Trash2 />
                </IconButton>
              </li>
            );
          })}
        </ol>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <Button variant="ghost" startIcon={<Plus />} onClick={() => set("lines", [...values.lines, blankLine()])} disabled={values.lines.length >= 50}>
            Add a line
          </Button>
          <dl className="grid min-w-56 grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-body-ui">
            <dt className="text-ink-muted">Subtotal</dt>
            <dd className="text-right tabular-nums text-ink">{money(totals.subtotalMinor)}</dd>
            <dt className="text-ink-muted">Tax</dt>
            <dd className="text-right tabular-nums text-ink">{money(totals.taxMinor)}</dd>
            <dt className="font-semibold text-ink">Total</dt>
            <dd className="text-right text-h4 tabular-nums text-ink">{money(totals.totalMinor)}</dd>
          </dl>
        </div>
      </Card>

      <Card padding="lg" as="section">
        <Field label="Notes" optional helperText="Payment details or a thank-you. Shown on the invoice." error={errors.notes?.[0]}>
          <Textarea value={values.notes} onChange={(e) => set("notes", e.target.value)} rows={4} maxLength={2000} />
        </Field>
      </Card>

      <div className="flex justify-end gap-2.5">
        <Button variant="secondary" onClick={() => router.push(invoiceId ? `${backHref}/${invoiceId}` : backHref)} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={pending}>
          {invoiceId ? "Save invoice" : "Create draft"}
        </Button>
      </div>
    </form>
  );
}
