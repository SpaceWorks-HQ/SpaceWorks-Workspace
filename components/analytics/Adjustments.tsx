"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card } from "@/components/ui/display";
import {
  saveAnalyticsAdjustment,
  removeAnalyticsAdjustment,
  uploadAnalyticsProof,
} from "@/app/actions/analytics";
import { displayDay, displayValue, parseCashAmount } from "@/lib/analytics/metrics";
import { currencyMinorDigits } from "@/lib/format/money";

export type AdjustmentRow = {
  id: string;
  title: string;
  dueOn: string;
  amountMinor: number;
  notes: string;
  files: { id: string; filename: string; contentType: string }[];
};
export function Adjustments({
  slug,
  currency,
  rows,
}: {
  slug: string;
  currency: string;
  rows: AdjustmentRow[];
}) {
  const [message, setMessage] = useState(""),
    [pending, start] = useTransition(),
    [files, setFiles] = useState<File[]>([]),
    [removing, setRemoving] = useState<string | null>(null),
    router = useRouter();
  async function save(form: FormData) {
    const amountMinor = parseCashAmount(
      String(form.get("amount") ?? ""),
      currency,
    );
    if (
      amountMinor === null ||
      amountMinor === 0 ||
      Math.abs(amountMinor) > 2147483647
    ) {
      setMessage("Enter a non-zero amount within the supported range.");
      return;
    }
    start(async () => {
      const r = await saveAnalyticsAdjustment(slug, {
        title: form.get("title"),
        dueOn: form.get("dueOn"),
        amountMinor,
        currency,
        notes: form.get("notes"),
      });
      if (!r.ok) {
        setMessage(r.error);
        return;
      }
      if (files.length) {
        const body = new FormData();
        for (const file of files) body.append("files", file);
        const proof = await uploadAnalyticsProof(slug, r.data!, body);
        setMessage(
          proof.ok
            ? "Adjustment and proof saved."
            : `Adjustment saved. ${proof.error}`,
        );
      } else setMessage("Adjustment saved.");
      setFiles([]);
      router.refresh();
    });
  }
  function upload(id: string, selected: File[]) {
    const body = new FormData();
    for (const f of selected) body.append("files", f);
    start(async () => {
      const r = await uploadAnalyticsProof(slug, id, body);
      setMessage(r.ok ? "Proof attached." : r.error);
      router.refresh();
    });
  }
  return (
    <Card as="section"
      id="adjustments"
      className="print:hidden"
    >
      <h2 className="text-h3">One-off forecast adjustments</h2>
      <a
        href={`/w/${slug}/analytics/export?kind=adjustments&currency=${currency}`}
        className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
      >
        Export adjustments CSV
      </a>
      <p className="text-body-sm text-ink-muted">
        Assumptions only. Positive amounts add cash; negative amounts spend
        cash. These do not post to Finance.
      </p>
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-accent-text">
          Add an adjustment
        </summary>
        <form action={save} className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" required>
            <Input name="title" maxLength={140} required />
          </Field>
          <Field label="Cash date" required>
            <Input type="date" name="dueOn" required />
          </Field>
          <Field
            label={`Amount in ${currency}`}
            helperText="Use a minus sign for money going out, such as -2500."
            required
          >
            <Input
              type="number"
              name="amount"
              min={-2147483647 / 10 ** currencyMinorDigits(currency)}
              max={2147483647 / 10 ** currencyMinorDigits(currency)}
              step={10 ** -currencyMinorDigits(currency)}
              required
            />
          </Field>
          <Field label="Notes" optional>
            <Textarea name="notes" maxLength={4000} />
          </Field>
          <div
            className="rounded-md border border-dashed border-line-strong p-4"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              setFiles(Array.from(e.dataTransfer.files));
            }}
          >
            <label className="block text-label" htmlFor="adjustment-proof">
              Proof · Optional · drop images or PDFs here
            </label>
            <input
              id="adjustment-proof"
              type="file"
              multiple
              accept="image/*,application/pdf"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="min-h-11 max-w-full py-3"
            />
            <label htmlFor="adjustment-camera" className="block text-label">
              Take a photo
            </label>
            <input
              id="adjustment-camera"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
              className="min-h-11 max-w-full py-3"
            />
            <p className="text-caption text-ink-muted">
              Ten files per upload, 10 MB each, 24 MB combined. {files.length}{" "}
              selected.
            </p>
          </div>
          <div>
            <Button type="submit" variant="primary" disabled={pending}>
              Add adjustment
            </Button>
          </div>
        </form>
      </details>
      {!rows.length ? <p className="mt-3 text-body-sm text-ink-muted">No adjustments yet. Add one for a planned cash movement.</p> : null}
      <ul className="divide-y divide-line">
        {rows.map((r) => (
          <li key={r.id} className="py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p>
                {r.title} · {displayDay(r.dueOn)} ·{" "}
                {displayValue(r.amountMinor, "money", currency)}
              </p>
              <Button
                variant="dangerOutline"
                disabled={pending}
                onClick={() => setRemoving(r.id)}
              >
                Remove assumption…
              </Button>
            </div>
            {r.notes ? (
              <p className="text-body-sm text-ink-muted">{r.notes}</p>
            ) : null}
            <label className="block min-h-11 py-3">
              Attach proof
              <input
                className="block max-w-full"
                type="file"
                multiple
                accept="image/*,application/pdf"
                disabled={pending}
                onChange={(e) => upload(r.id, Array.from(e.target.files ?? []))}
              />
            </label>
            <ul className="flex flex-wrap gap-3">
              {r.files.map((f) => (
                <li key={f.id}>
                  <a
                    className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
                    href={`/api/files/${f.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Preview {f.filename}
                  </a>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        title="Remove forecast assumption?"
        message="This removes the one-off forecast line and its private proof links. The finance ledger is unchanged."
        confirmLabel="Remove assumption"
        loading={pending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          start(async () => {
            const r = await removeAnalyticsAdjustment(slug, removing);
            setMessage(r.ok ? "Adjustment removed." : r.error);
            if (r.ok) {
              setRemoving(null);
              router.refresh();
            }
          });
        }}
      />
      <p role="status">{message}</p>
    </Card>
  );
}

