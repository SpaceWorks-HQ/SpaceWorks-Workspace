"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createJobAction, deleteJobAction, runJobNowAction, updateJobAction } from "@/app/actions/assistant";
import { Button } from "@/components/ui/button";
import { Callout, Card, Chip, EmptyState } from "@/components/ui/display";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Dropdown, Field, Input, Textarea } from "@/components/ui/field";
import { CheckboxCard, SwitchRow } from "@/components/ui/choice";
import { useToast } from "@/components/feedback/ToastProvider";
import { JOB_TEMPLATES, upcomingRuns, validateCron } from "@/lib/assistant/cron";

type Job = {
  id: string;
  name: string;
  cron: string;
  timezone: string;
  prompt: string;
  channelId: string | null;
  channelSlug: string | null;
  enabled: boolean;
  destinationIds: string[];
  lastRun: string | null;
  nextRun: string | null;
  lastStatus: string | null;
};
type Draft = Omit<Job, "channelSlug" | "lastRun" | "nextRun" | "lastStatus" | "id"> & { id: string | null };

const KIND_LABEL: Record<string, string> = {
  IN_APP_USERS: "In-app",
  WORKSPACE_CHANNEL: "Channel",
  EMAIL: "Email",
  SLACK: "Slack",
  DISCORD: "Discord",
  MATTERMOST: "Mattermost",
  TELEGRAM: "Telegram",
  WHATSAPP: "WhatsApp",
  WEBHOOK: "Webhook",
};

function statusChip(job: Job) {
  if (!job.enabled) return <Chip size="sm" tone="outline">Paused</Chip>;
  if (!job.lastStatus) return <Chip size="sm" tone="info">Scheduled</Chip>;
  if (job.lastStatus === "ok") return <Chip size="sm" tone="success">Last run ok</Chip>;
  if (job.lastStatus.startsWith("failed")) return <Chip size="sm" tone="danger">Last run failed</Chip>;
  return <Chip size="sm" tone="warning">Skipped</Chip>;
}

export function JobsManager({
  slug,
  configured,
  defaultTimeZone,
  channels,
  destinations,
  jobs,
}: {
  slug: string;
  configured: boolean;
  defaultTimeZone: string;
  channels: Array<{ id: string; label: string }>;
  destinations: Array<{ id: string; name: string; kind: string }>;
  jobs: Job[];
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [deleting, setDeleting] = useState<Job | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const fromTemplate = (key: string): Draft => {
    const template = JOB_TEMPLATES.find((t) => t.key === key) ?? JOB_TEMPLATES[0];
    return { id: null, name: template.name, cron: template.cron, timezone: defaultTimeZone, prompt: template.prompt, channelId: null, enabled: true, destinationIds: [] };
  };

  const preview = useMemo(() => {
    if (!draft) return null;
    const check = validateCron(draft.cron, draft.timezone);
    if (!check.ok) return { error: check.error };
    const runs = upcomingRuns(draft.cron, draft.timezone, new Date(), 3);
    const format = new Intl.DateTimeFormat("en-IN", { timeZone: draft.timezone, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    return { runs: runs.map((run) => format.format(run)) };
  }, [draft]);

  const act = (fn: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }>, success: string, after?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (!result.ok) {
        setErrors(result.fieldErrors ?? {});
        showToast(result.error ?? "Couldn't save. Try again.", "error");
      } else {
        setErrors({});
        after?.();
        showToast(success, "success");
        router.refresh();
      }
    });

  const runNow = (job: Job) => {
    setRunning(job.id);
    startTransition(async () => {
      const result = await runJobNowAction(slug, { jobId: job.id });
      setRunning(null);
      if (!result.ok) showToast(result.error, "error");
      else showToast(job.channelSlug ? `Posted to #${job.channelSlug}.` : "Done. The result is in your assistant conversations.", "success");
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[640px] text-body-ui text-ink-secondary">The assistant runs these on a schedule with read-only access and member-level rights, then posts the result where you choose.</p>
        <Button variant="primary" startIcon={<Plus />} onClick={() => { setErrors({}); setDraft(fromTemplate("morning-digest")); }}>New job</Button>
      </div>
      {!configured ? <Callout tone="warning" title="The assistant isn't set up yet.">Jobs are saved but won&apos;t run until an AI key is added in instance settings.</Callout> : null}

      {jobs.length === 0 ? (
        <EmptyState title="No scheduled jobs yet." action={<Button variant="primary" onClick={() => { setErrors({}); setDraft(fromTemplate("morning-digest")); }}>Start with the morning digest</Button>}>
          A morning digest of what&apos;s due, what&apos;s on and what changed keeps the crew up to date.
        </EmptyState>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-line">
            {jobs.map((job) => (
              <li key={job.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-label text-ink">{job.name} {statusChip(job)}</p>
                  <p className="mt-0.5 text-caption text-ink-muted">
                    <span className="tabular-nums">{job.cron}</span> ({job.timezone})
                    {job.channelSlug ? ` · posts to #${job.channelSlug}` : " · kept in your conversations"}
                    {job.destinationIds.length ? ` · sends to ${job.destinationIds.length} destination${job.destinationIds.length === 1 ? "" : "s"}` : ""}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {job.nextRun ? `Next run ${job.nextRun}` : "Not scheduled"}
                    {job.lastRun ? ` · last run ${job.lastRun}` : ""}
                    {job.lastStatus && job.lastStatus !== "ok" ? ` · ${job.lastStatus}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Button size="sm" variant="secondary" loading={running === job.id} disabled={!configured || running !== null} onClick={() => runNow(job)}>Run now</Button>
                  <Button size="sm" variant="secondary" onClick={() => { setErrors({}); setDraft({ id: job.id, name: job.name, cron: job.cron, timezone: job.timezone, prompt: job.prompt, channelId: job.channelId, enabled: job.enabled, destinationIds: job.destinationIds }); }}>Edit</Button>
                  <Button size="sm" variant="dangerOutline" onClick={() => setDeleting(job)}>Delete…</Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent size="md">
          <DialogHeader title={draft?.id ? "Edit scheduled job" : "New scheduled job"} description="What the assistant should do, when, and where the answer goes." />
          {draft ? (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(event) => {
                event.preventDefault();
                const payload = { name: draft.name, cron: draft.cron, timezone: draft.timezone, prompt: draft.prompt, channelId: draft.channelId, destinationIds: draft.destinationIds, enabled: draft.enabled };
                act(() => (draft.id ? updateJobAction(slug, { ...payload, jobId: draft.id }) : createJobAction(slug, payload)), draft.id ? "Job saved." : "Job scheduled.", () => setDraft(null));
              }}
            >
              <DialogBody className="flex flex-col gap-4">
                {!draft.id ? (
                  <Field label="Start from">
                    <Dropdown defaultValue="morning-digest" onChange={(e) => setDraft(fromTemplate(e.target.value))}>
                      {JOB_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                    </Dropdown>
                  </Field>
                ) : null}
                <Field label="Name" error={errors.name?.[0]}><Input value={draft.name} maxLength={80} required onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Schedule (cron)" helperText="minute hour day month weekday" error={errors.cron?.[0]}>
                    <Input value={draft.cron} maxLength={100} required className="tabular-nums" onChange={(e) => setDraft({ ...draft, cron: e.target.value })} />
                  </Field>
                  <Field label="Time zone" error={errors.timezone?.[0]}><Input value={draft.timezone} maxLength={64} required onChange={(e) => setDraft({ ...draft, timezone: e.target.value })} /></Field>
                </div>
                <p className="text-caption text-ink-muted" aria-live="polite">
                  {preview && "error" in preview ? preview.error : preview ? `Next runs: ${preview.runs.join(" · ")}` : null}
                </p>
                <Field label="What should the assistant do?" error={errors.prompt?.[0]}>
                  <Textarea rows={5} value={draft.prompt} maxLength={4000} required onChange={(e) => setDraft({ ...draft, prompt: e.target.value })} />
                </Field>
                <Field label="Post the result in" error={errors.channelId?.[0]}>
                  <Dropdown value={draft.channelId ?? ""} onChange={(e) => setDraft({ ...draft, channelId: e.target.value || null })}>
                    <option value="">Don&apos;t post (keep it in my conversations)</option>
                    {channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </Dropdown>
                </Field>
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1.5 text-label text-ink">Send to</legend>
                  {destinations.length === 0 ? (
                    <p className="text-caption text-ink-muted">
                      No notification destinations yet. Add email, chat or webhook destinations in <Link className="font-semibold underline" href={`/w/${slug}/settings/notifications`}>notification settings</Link>.
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {destinations.map((d) => (
                        <CheckboxCard
                          key={d.id}
                          label={d.name}
                          description={KIND_LABEL[d.kind] ?? d.kind}
                          checked={draft.destinationIds.includes(d.id)}
                          onCheckedChange={(checked) =>
                            setDraft({ ...draft, destinationIds: checked ? [...draft.destinationIds, d.id] : draft.destinationIds.filter((id) => id !== d.id) })
                          }
                        />
                      ))}
                    </div>
                  )}
                </fieldset>
                <SwitchRow label="Enabled" description="Paused jobs keep their settings and don't run." checked={draft.enabled} onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })} />
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
                <Button type="submit" variant="primary" loading={pending}>{draft.id ? "Save job" : "Schedule job"}</Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? "this job"}?`}
        message="It stops running and its Send to choices are removed."
        confirmLabel="Delete job"
        loading={pending}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && act(() => deleteJobAction(slug, { jobId: deleting.id }), "Job deleted.", () => setDeleting(null))}
      />
    </div>
  );
}
