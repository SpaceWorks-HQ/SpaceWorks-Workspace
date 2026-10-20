"use client";
import { useState, useTransition } from "react";
import { saveTaskPlanAction } from "@/app/actions/projectsPlus";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { formatDate } from "@/lib/format/datetime";
import type { TaskDetailDTO } from "@/lib/tasks/types";

export function TaskPlan({ slug, task, reload }: { slug: string; task: TaskDetailDTO; reload: () => Promise<void> }) {
  const [busy, start] = useTransition(); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  const canEdit = task.permissions.canEdit && !task.archivedAt;
  return <section className="flex flex-col gap-3 [overflow-wrap:anywhere]" aria-labelledby={`plan-${task.id}`}>
    <h3 id={`plan-${task.id}`} className="text-title">Schedule and blocker</h3>
    {canEdit ? <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); start(async () => {
      try { const r = await saveTaskPlanAction(slug, { taskId: task.id, startsOn: f.get("startsOn") || null, blockerReason: f.get("blockerReason"), blockerOwnerId: f.get("blockerOwnerId") || null });
        if (!r.ok) setError(r.error); else { setError(""); setMessage("Schedule and blocker saved."); await reload(); }
      } catch { setError("Couldn't save the plan. Try again."); }
    }); }}>
      <Field label="Start date" optional><Input name="startsOn" type="date" defaultValue={task.startsOn ?? ""} /></Field>
      <Field label="Blocked reason" optional helperText="Clear this to remove the manual blocker. Dependencies are managed below."><Textarea name="blockerReason" maxLength={1000} defaultValue={task.blockerReason ?? ""} /></Field>
      <Field label="Blocker owner" optional><Dropdown name="blockerOwnerId" defaultValue={task.blockerOwnerId ?? ""}><option value="">Choose a member</option>{task.members.map(p => <option value={p.id} key={p.id}>{p.name ?? "Member"}</option>)}</Dropdown></Field>
      {error ? <p role="alert" className="text-danger-fg">{error}</p> : null}{message ? <p role="status">{message}</p> : null}
      <Button type="submit" loading={busy} variant="secondary" className="self-start">Save schedule and blocker</Button>
    </form> : <div className="space-y-2 text-body-ui"><p>Start: {task.startsOn ? formatDate(`${task.startsOn}T00:00:00Z`, "UTC") : "Not set"}</p><p className="whitespace-pre-wrap">{task.blockerReason ?? "No manual blocker."}</p>{task.blockerReason ? <p>Owner: {task.members.find(p => p.id === task.blockerOwnerId)?.name ?? "Former member"}</p> : null}</div>}
  </section>;
}
