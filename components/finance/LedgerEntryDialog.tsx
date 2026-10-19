"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createLedgerEntryAction, updateLedgerEntryAction } from "@/app/actions/finance";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { CheckboxField, SegmentedControl } from "@/components/ui/choice";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input, PrefixInput } from "@/components/ui/field";
import { currencySymbol, type LedgerKindValue } from "@/lib/finance/money";

export type CategoryOption = { id: string; name: string; kind: LedgerKindValue; archived?: boolean };
export type BudgetOption = { id: string; name: string };

export type EditableEntry = {
  id: string;
  kind: LedgerKindValue;
  amount: string;
  occurredOn: string;
  description: string;
  counterparty: string;
  categoryId: string;
  budgetId: string;
  receiptFileId: string | null;
  receiptName: string | null;
  /** Posted from another record: money facts are locked. */
  linkedLabel: string | null;
};

export function LedgerEntryDialog({
  slug,
  currency,
  today,
  categories,
  budgets,
  entry,
  open,
  onOpenChange,
}: {
  slug: string;
  currency: string;
  today: string;
  categories: CategoryOption[];
  budgets: BudgetOption[];
  entry?: EditableEntry;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<LedgerKindValue>(entry?.kind ?? "EXPENSE");
  const [categoryId, setCategoryId] = useState(entry?.categoryId ?? "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const locked = Boolean(entry?.linkedLabel);
  const choices = categories.filter((c) => c.kind === kind && (!c.archived || c.id === entry?.categoryId));

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent size="md">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            form.set("kind", kind);
            startTransition(async () => {
              const result = entry ? await updateLedgerEntryAction(slug, entry.id, form) : await createLedgerEntryAction(slug, form);
              if (!result.ok) {
                setErrors(result.fieldErrors ?? {});
                showToast(result.error, "error");
                return;
              }
              setErrors({});
              showToast(entry ? "Entry updated." : "Entry recorded.", "success");
              onOpenChange(false);
              router.refresh();
            });
          }}
        >
          <DialogHeader title={entry ? "Edit entry" : "Record an entry"} description={locked ? `${entry!.linkedLabel}. Its amount and date come from there.` : "Money that came into or went out of the kitty."} />
          <DialogBody className="flex flex-col gap-4">
            {locked ? null : (
              <SegmentedControl
                ariaLabel="Money in or out"
                value={kind}
                onValueChange={(next) => {
                  setKind(next);
                  setCategoryId("");
                }}
                options={[
                  { value: "EXPENSE", label: "Money out" },
                  { value: "INCOME", label: "Money in" },
                ]}
              />
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount" required error={errors.amount?.[0]}>
                <PrefixInput prefix={currencySymbol(currency)} name="amount" inputMode="decimal" autoComplete="off" defaultValue={entry?.amount} disabled={locked} placeholder="0.00" />
              </Field>
              <Field label="Date" required error={errors.occurredOn?.[0]}>
                <Input type="date" name="occurredOn" defaultValue={entry?.occurredOn ?? today} max="2100-12-31" disabled={locked} />
              </Field>
            </div>
            {locked ? (
              <>
                <input type="hidden" name="amount" value={entry!.amount} />
                <input type="hidden" name="occurredOn" value={entry!.occurredOn} />
              </>
            ) : null}
            <Field label="Description" required error={errors.description?.[0]}>
              <Input name="description" defaultValue={entry?.description} maxLength={200} placeholder={kind === "INCOME" ? "October contributions" : "Motor drivers and IR sensors"} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={kind === "INCOME" ? "From" : "Paid to"} optional error={errors.counterparty?.[0]}>
                <Input name="counterparty" defaultValue={entry?.counterparty} maxLength={120} />
              </Field>
              <Field label="Category" optional error={errors.categoryId?.[0]}>
                <Dropdown name="categoryId" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                  <option value="">No category</option>
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Dropdown>
              </Field>
            </div>
            {budgets.length && kind === "EXPENSE" ? (
              <Field label="Budget" optional helperText="Counts this expense against a budget." error={errors.budgetId?.[0]}>
                <Dropdown name="budgetId" defaultValue={entry?.budgetId ?? ""}>
                  <option value="">No budget</option>
                  {budgets.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Dropdown>
              </Field>
            ) : (
              <input type="hidden" name="budgetId" value={kind === "EXPENSE" ? (entry?.budgetId ?? "") : ""} />
            )}
            <Field label="Receipt" optional helperText="A photo or PDF, up to 10 MB. Only people who can see finance can open it." error={errors.receipt?.[0]}>
              <Input type="file" name="receipt" accept="image/png,image/jpeg,image/webp,image/gif,application/pdf" className="py-2" />
            </Field>
            {entry?.receiptFileId ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2">
                <a href={`/api/files/${entry.receiptFileId}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-body-ui text-accent-text underline underline-offset-4">
                  {entry.receiptName ?? "Current receipt"}
                </a>
                <CheckboxField name="removeReceipt" value="1" label="Remove" />
              </div>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={pending}>
              {entry ? "Save changes" : "Record entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
