"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, Chip } from "@/components/ui/display";
import { CheckboxField } from "@/components/ui/choice";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  saveAnalyticsPreset,
  removeAnalyticsPreset,
  saveAnalyticsAdjustment,
  removeAnalyticsAdjustment,
  uploadAnalyticsProof,
  generateAnalyticsPack,
} from "@/app/actions/analytics";
import type { AnalyticsQuery, PresetView } from "@/lib/analytics/types";
import {
  queryString,
  displayDay,
  displayValue,
  parseCashAmount,
} from "@/lib/analytics/metrics";
import { currencyMinorDigits } from "@/lib/format/money";
export function SavedReports({
  slug,
  q,
  presets,
  admin,
  viewerId,
  admins,
}: {
  slug: string;
  q: AnalyticsQuery;
  presets: PresetView[];
  admin: boolean;
  viewerId: string;
  admins: { id: string; name: string }[];
}) {
  const [message, setMessage] = useState(""),
    [pending, start] = useTransition(),
    [removing, setRemoving] = useState<string | null>(null),
    router = useRouter();
  function save(form: FormData) {
    start(async () => {
      const r = await saveAnalyticsPreset(slug, {
        name: form.get("name"),
        query: {
          ...q,
          monthlyEmail: form.get("monthlyEmail") === "on",
          emailTo: form.getAll("emailTo"),
        },
        shared: form.get("shared") === "on",
        pinned: form.get("pinned") === "on",
        commentary: form.get("commentary"),
      });
      setMessage(r.ok ? "Report saved." : r.error);
      if (r.ok) router.refresh();
    });
  }
  function revise(p: PresetView, form: FormData) {
    start(async () => {
      const r = await saveAnalyticsPreset(slug, {
        id: p.id,
        name: form.get("name"),
        query: {
          ...p.query,
          monthlyEmail: form.get("monthlyEmail") === "on",
          emailTo: form.getAll("emailTo"),
        },
        shared: form.get("shared") === "on",
        pinned: form.get("pinned") === "on",
        commentary: form.get("commentary"),
      });
      setMessage(r.ok ? "Saved report updated." : r.error);
      if (r.ok) router.refresh();
    });
  }
  return (
    <Card as="section" className="print:hidden">
      <h2 className="text-h3">Saved reports and packs</h2>
      <a
        href={`/w/${slug}/analytics/export?kind=presets`}
        className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
      >
        Export saved views CSV
      </a>
      <p className="mt-1 text-body-sm text-ink-muted">
        Save these filters, add commentary, then prepare a private report pack.
        Shared views recheck each reader’s permissions.
      </p>
      <details className="mt-3">
        <summary className="min-h-11 cursor-pointer py-3 text-accent-text">
          Save this view
        </summary>
        <form action={save} className="grid gap-4">
          <Field label="Report name" required>
            <Input name="name" maxLength={100} required />
          </Field>
          {admin ? (
            <Field label="Commentary" optional>
              <Textarea name="commentary" maxLength={12000} rows={4} />
            </Field>
          ) : (
            <input name="commentary" type="hidden" value="" />
          )}
          <CheckboxField name="pinned" label="Pin to overview" />
          {admin ? (
            <CheckboxField name="shared" label="Share this view with admins" />
          ) : null}
          {admin ? (
            <fieldset className="grid gap-2">
              <legend className="text-label">
                Monthly management PDF email · Optional
              </legend>
              <CheckboxField name="monthlyEmail" label="Email the previous month’s management report" />
              <p className="text-caption text-ink-muted">
                Choose Last month and Share with admins to enable this.
              </p>
              {admins.map((a) => (
                <CheckboxField name="emailTo" value={a.id} label={a.name} key={a.id} />
              ))}
            </fieldset>
          ) : null}
          <Button type="submit" variant="primary" disabled={pending}>
            Save report
          </Button>
        </form>
      </details>
      {!presets.length ? <p className="mt-3 text-body-sm text-ink-muted">No saved reports yet. Save this view to return to it.</p> : null}
      <ul className="mt-3 divide-y divide-line">
        {presets.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center justify-between gap-2 py-3"
          >
            <div>
              <a
                className="inline-flex min-h-11 min-w-11 items-center text-accent-text underline"
                href={`/w/${slug}/analytics?${queryString(p.query)}`}
              >
                {p.name}
                {p.pinned ? <Chip className="ml-2" tone="accent">Pinned</Chip> : null}
              </a>
              {p.shared ? (
                <Chip className="ml-2" tone="info">Shared with admins</Chip>
              ) : null}
              {p.ownerId === viewerId ? (
                <details className="mt-2">
                  <summary className="min-h-11 cursor-pointer py-3 text-accent-text">
                    Edit saved view and commentary
                  </summary>
                  <form
                    action={(form) => revise(p, form)}
                    className="grid gap-3"
                  >
                    <Field label="Report name">
                      <Input
                        name="name"
                        required
                        maxLength={100}
                        defaultValue={p.name}
                      />
                    </Field>
                    <Field label="Commentary" optional>
                      <Textarea
                        name="commentary"
                        defaultValue={p.commentary}
                        maxLength={12000}
                        rows={4}
                      />
                    </Field>
                    <CheckboxField name="pinned" defaultChecked={p.pinned} label="Pin to overview" />
                    {admin ? (
                      <CheckboxField name="shared" defaultChecked={p.shared} label="Share the view with admins" />
                    ) : null}
                    {admin ? (
                      <fieldset>
                        <legend className="text-label">
                          Monthly management PDF email · Optional
                        </legend>
                        <CheckboxField name="monthlyEmail" defaultChecked={p.query.monthlyEmail} label="Email last month’s report" />
                        {admins.map((a) => (
                          <CheckboxField key={a.id} name="emailTo" value={a.id} defaultChecked={p.query.emailTo?.includes(a.id)} label={a.name} />
                        ))}
                      </fieldset>
                    ) : null}
                    <Button type="submit" variant="primary" disabled={pending}>
                      Update saved report
                    </Button>
                  </form>
                </details>
              ) : null}
              <div className="flex flex-wrap gap-3">
                {p.fileIds.map((id, i) => (
                  <a
                    key={id}
                    className="min-h-11 py-3 text-body-sm text-accent-text underline"
                    href={`/api/files/${id}`}
                  >
                    Saved PDF {i + 1}
                  </a>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {admin ? (
                <>
                  <a
                    className="min-h-11 p-3 text-accent-text underline"
                    href={`/w/${slug}/analytics/print?preset=${p.id}&kind=management`}
                  >
                    Print management
                  </a>
                  <a
                    className="min-h-11 p-3 text-accent-text underline"
                    href={`/w/${slug}/analytics/print?preset=${p.id}&kind=board`}
                  >
                    Print board/funder
                  </a>
                  {p.ownerId === viewerId
                    ? (["management", "board"] as const).map((kind) => (
                        <Button
                          key={kind}
                          variant="secondary"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const r = await generateAnalyticsPack(
                                slug,
                                p.id,
                                kind,
                              );
                              setMessage(
                                r.ok ? "PDF saved in private files." : r.error,
                              );
                              router.refresh();
                            })
                          }
                        >
                          Save {kind} PDF
                        </Button>
                      ))
                    : null}
                </>
              ) : null}
              {p.ownerId === viewerId ? (
                <Button
                  variant="dangerOutline"
                  disabled={pending}
                  onClick={() => setRemoving(p.id)}
                >
                  Remove saved view…
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={removing !== null}
        title="Remove saved report?"
        message="This removes the saved view and its private PDF links. Download any snapshots you want to keep first."
        confirmLabel="Remove saved report"
        loading={pending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return;
          start(async () => {
            const r = await removeAnalyticsPreset(slug, removing);
            setMessage(r.ok ? "Saved view removed." : r.error);
            if (r.ok) {
              setRemoving(null);
              router.refresh();
            }
          });
        }}
      />
      <p role="status" className="mt-3 text-body-sm">
        {message}
      </p>
    </Card>
  );
}
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

export function CashThreshold({
  slug,
  q,
  currency,
  value,
}: {
  slug: string;
  q: AnalyticsQuery;
  currency: string;
  value: number;
}) {
  const router = useRouter(),
    [error, setError] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-3 print:hidden"
      action={(form) => {
        const amount = parseCashAmount(
          String(form.get("amount") ?? ""),
          currency,
        );
        if (amount === null || amount < 0 || amount > 999999999999) {
          setError("Enter a cash threshold within the supported range.");
          return;
        }
        setError("");
        router.push(
          `/w/${slug}/analytics?${queryString({ ...q, threshold: String(amount) })}`,
        );
      }}
    >
      <Field label={`Low cash threshold in ${currency}`}>
        <Input
          name="amount"
          type="number"
          min="0"
          max={999999999999 / 10 ** currencyMinorDigits(currency)}
          step={10 ** -currencyMinorDigits(currency)}
          defaultValue={value / 10 ** currencyMinorDigits(currency)}
          required
        />
      </Field>
      <Button type="submit" variant="secondary">
        Update threshold
      </Button>
      <p role="status" className="text-body-sm text-danger-fg">
        {error}
      </p>
    </form>
  );
}
