"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Card, Chip } from "@/components/ui/display";
import { CheckboxField } from "@/components/ui/choice";
import {
  saveAnalyticsPreset,
  removeAnalyticsPreset,
  generateAnalyticsPack,
} from "@/app/actions/analytics";
import type { AnalyticsQuery, PresetView } from "@/lib/analytics/types";
import { queryString } from "@/lib/analytics/metrics";

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
