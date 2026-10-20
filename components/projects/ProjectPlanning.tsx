"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveMilestoneAction, removeMilestoneAction, postProjectUpdateAction } from "@/app/actions/projectsPlus";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { ConfirmDialog } from "@/components/ui/dialog";
import { HEALTH_LABELS, MILESTONE_LABELS } from "@/lib/projects/plusLogic";
import { formatDate, formatRelativeTime } from "@/lib/format/datetime";
import type { MilestoneRow, ProjectPlan, UpdateRow } from "@/lib/projects/plusTypes";
import { MultiSelect } from "@/components/tasks/MultiSelect";

function MilestoneForm({ slug, plan, milestone, onClose }: { slug: string; plan: ProjectPlan; milestone?: MilestoneRow; onClose: () => void }) {
  const [selected, setSelected] = useState(milestone?.taskIds ?? []);
  const [busy, start] = useTransition();
  const [error, setError] = useState("");
  const router = useRouter();
  const options = new Map(plan.tasks.map(t => [t.id, { id: t.id, label: `${t.reference} ${t.title}` }]));
  for (const t of milestone?.tasks ?? []) if (!options.has(t.id)) options.set(t.id, { id: t.id, label: `${t.title}${t.archived ? " (archived)" : ""}` });
  return <form className="flex flex-col gap-4 rounded-xl border border-line p-4" onSubmit={event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    start(async () => { try {
      const result = await saveMilestoneAction(slug, { projectId: plan.projectId, id: milestone?.id, name: form.get("name"), targetOn: form.get("targetOn"), status: form.get("status"), notes: form.get("notes"), taskIds: selected });
      if (!result.ok) setError(result.error); else { router.refresh(); onClose(); }
    } catch { setError("Couldn't save the milestone. Try again."); } });
  }}>
    <Field label="Milestone name"><Input name="name" required maxLength={120} defaultValue={milestone?.name} /></Field>
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Target date"><Input type="date" name="targetOn" required defaultValue={milestone?.targetOn} /></Field>
      <Field label="Manual status" helperText="Linked tasks also mark it done when every task is complete."><Dropdown name="status" defaultValue={milestone?.manualStatus ?? "PENDING"}>{Object.entries(MILESTONE_LABELS).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</Dropdown></Field>
    </div>
    <MultiSelect title="Linked tasks" trigger={<Button variant="secondary">Link tasks ({selected.length})</Button>} items={[...options.values()]} selected={selected} onChange={setSelected} searchPlaceholder="Find a task" />
    <Field label="Notes" optional><Textarea name="notes" maxLength={2000} defaultValue={milestone?.notes} /></Field>
    {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button type="submit" loading={busy}>Save milestone</Button><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button></div>
  </form>;
}
export function ProjectMilestones({ slug, plan }: { slug: string; plan: ProjectPlan }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, start] = useTransition(); const [error, setError] = useState(""); const router = useRouter();
  return <Card className="[overflow-wrap:anywhere]"><CardHeader title="Milestones" action={plan.canManage && editing === null ? <Button variant="secondary" onClick={() => setEditing("new")}>Add milestone</Button> : null} />
    {editing ? <MilestoneForm key={editing} slug={slug} plan={plan} milestone={plan.milestones.find(m => m.id === editing)} onClose={() => setEditing(null)} /> : null}
    {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}
    {plan.milestones.length ? <ul className="divide-y divide-line">{plan.milestones.map(m => <li key={m.id} className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-center gap-2"><h3 className="min-w-0 break-words text-title">{m.name}</h3><Chip tone={m.status === "DONE" ? "success" : "neutral"}>{MILESTONE_LABELS[m.status]}</Chip></div>
      <p className="text-caption text-ink-muted">Target {formatDate(`${m.targetOn}T00:00:00Z`, "UTC")} · {m.tasks.filter(t => t.done).length}/{m.tasks.length} linked tasks done{m.status === "DONE" ? m.manualStatus === "DONE" ? " · Marked done manually" : " · All linked tasks done" : ""}</p>
      {m.notes ? <p className="whitespace-pre-wrap break-words text-body-ui">{m.notes}</p> : null}
      {m.tasks.length ? <ul className="text-body-ui text-ink-secondary">{m.tasks.map(t => <li key={t.id}>{t.done ? "Done" : "Open"}: {t.title}{t.archived ? " (archived)" : ""}</li>)}</ul> : null}
      {plan.canManage ? <div className="flex flex-wrap gap-2"><Button variant="quiet" aria-label={`Edit ${m.name}`} disabled={busy} onClick={() => setEditing(m.id)}>Edit milestone</Button>
        <Button variant="dangerQuiet" aria-label={`Remove ${m.name}`} disabled={busy} onClick={() => setRemoving(m.id)}>Remove…</Button>
        <ConfirmDialog open={removing === m.id} loading={busy} title="Remove milestone?" message={<span className="[overflow-wrap:anywhere]">Remove “{m.name}” and its task links? Tasks stay in the project.</span>} confirmLabel="Remove milestone" onCancel={() => setRemoving(null)} onConfirm={() => start(async () => { try { const result = await removeMilestoneAction(slug, { projectId: plan.projectId, id: m.id }); if (!result.ok) setError(result.error); else { setRemoving(null); router.refresh(); } } catch { setError("Couldn't remove the milestone. Try again."); } })} />
      </div> : null}
    </li>)}</ul> : <EmptyState title="No milestones yet. Mark the next step for this project." patch action={plan.canManage ? <Button onClick={() => setEditing("new")}>Add milestone</Button> : <Button asChild variant="secondary"><a href={plan.base}>View tasks</a></Button>} />}
  </Card>;
}
export function ProjectUpdateForm({ slug, plan }: { slug: string; plan: ProjectPlan }) {
  const [busy, start] = useTransition(); const [error, setError] = useState(""); const [saved, setSaved] = useState(false); const router = useRouter();
  if (!plan.canManage) return null;
  return <Card><CardHeader title="Weekly update" description="A short note for the team. Updates stay in the history." />
    <form className="flex flex-col gap-4" onSubmit={event => { event.preventDefault(); const element = event.currentTarget; const form = new FormData(element);
      const lines = (name: string) => String(form.get(name) ?? "").split("\n").map(s => s.trim()).filter(Boolean);
      start(async () => { try { const result = await postProjectUpdateAction(slug, { projectId: plan.projectId, status: form.get("status"), note: form.get("note"), blockers: lines("blockers"), nextSteps: lines("nextSteps") });
        if (!result.ok) setError(result.error); else { setError(""); setSaved(true); element.reset(); router.refresh(); }
      } catch { setError("Couldn't post the update. Try again."); } });
    }}>
      <Field label="Project health"><Dropdown name="status" defaultValue="ON_TRACK">{Object.entries(HEALTH_LABELS).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</Dropdown></Field>
      <Field label="Progress note"><Textarea required name="note" maxLength={2000} /></Field>
      <Field label="Blockers" optional helperText="One per line, up to 20. Track task blockers on the task itself."><Textarea name="blockers" maxLength={10000} /></Field>
      <Field label="Next steps" optional helperText="One per line, up to 20."><Textarea name="nextSteps" maxLength={10000} /></Field>
      {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}{saved ? <p role="status">Update posted.</p> : null}
      <Button type="submit" loading={busy} className="self-start">Post update</Button>
    </form>
  </Card>;
}
export function ProjectUpdateHistory({ updates, timeZone, base }: { updates: UpdateRow[]; timeZone: string; base: string }) {
  return <Card><CardHeader title="Update history" />{updates.length ? <ol className="divide-y divide-line">{updates.map(u => <li key={u.id} className="flex flex-col gap-3 py-4 break-words">
    <div className="flex flex-wrap items-center gap-2"><Chip tone={u.status === "ON_TRACK" ? "success" : u.status === "AT_RISK" ? "warning" : "danger"}>{HEALTH_LABELS[u.status]}</Chip><span className="text-caption text-ink-muted">{u.author} · {formatRelativeTime(u.createdAt, timeZone)}</span></div>
    <p className="whitespace-pre-wrap">{u.note}</p>
    {u.blockers.length ? <div><h3 className="text-label">Blockers</h3><ul className="list-disc pl-5">{u.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div> : null}
    {u.nextSteps.length ? <div><h3 className="text-label">Next steps</h3><ul className="list-disc pl-5">{u.nextSteps.map((b, i) => <li key={i}>{b}</li>)}</ul></div> : null}
  </li>)}</ol> : <EmptyState title="No updates yet. Share where this project stands." patch action={<Button asChild variant="secondary"><a href={`${base}/overview`}>View project</a></Button>} />}</Card>;
}
