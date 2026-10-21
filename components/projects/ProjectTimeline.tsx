import Link from "next/link";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { timelinePosition, timelineRange, MILESTONE_LABELS } from "@/lib/projects/plusLogic";
import { formatDate } from "@/lib/format/datetime";
import type { ProjectPlan, PlanTask } from "@/lib/projects/plusTypes";

export function BlockerDetails({ task }: { task: PlanTask }) {
  return <div className="space-y-1 break-words text-body-ui text-ink-secondary">
    {task.blockerReason ? <p className="whitespace-pre-wrap">Blocked: {task.blockerReason}</p> : null}
    {task.blockedBy.map(b => <p key={b.url}>Blocked by <Link href={b.url} className="underline">{b.reference}: {b.title}</Link></p>)}
    {task.restrictedBlocker ? <p>Blocked by a restricted task. Ask the project lead for an update.</p> : null}
  </div>;
}
export function ProjectTimeline({ plan }: { plan: ProjectPlan }) {
  const range = timelineRange([...plan.tasks.map(t => ({ start: t.start, end: t.end })), ...plan.milestones.map(m => ({ start: m.targetOn, end: m.targetOn })), { start: plan.startsOn, end: plan.dueOn }]);
  const date = (s: string) => formatDate(`${s}T00:00:00Z`, "UTC");
  return <Card className="[overflow-wrap:anywhere]"><CardHeader title="Timeline" description="Task start and due dates, with milestone targets. Set dates from each task." />
    {!plan.tasks.length && !plan.milestones.length ? <EmptyState patch title="No schedule yet. Add a task to start planning." action={<Button asChild><Link href={plan.base}>View tasks</Link></Button>} /> : <>
      {range ? <div className="mb-4 hidden grid-cols-[minmax(180px,1fr)_2fr] gap-6 sm:grid"><span className="text-label">Schedule</span><div className="flex justify-between text-caption"><span>{date(range.start)}</span><span>{date(range.end)}</span></div></div> : null}
      <ul className="divide-y divide-line">{plan.tasks.map(t => <li key={t.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(180px,1fr)_2fr] sm:gap-6">
        <div className="min-w-0 space-y-2"><Link className="break-words text-title underline-offset-4 hover:underline" href={t.url}>{t.reference}: {t.title}</Link>
          <p className="text-caption text-ink-muted">{t.start ? date(t.start) : "Start not set"} → {t.end ? date(t.end) : "Due not set"}</p>
          <p className="text-caption text-ink-muted">{t.owner}{t.parentId ? " · Subtask" : ""}</p>
          <div className="flex flex-wrap gap-2"><Chip tone={t.done ? "success" : "neutral"}>{t.done ? "Done" : "Open"}</Chip>{t.overdue ? <Chip tone="danger">Overdue</Chip> : null}</div>
          <BlockerDetails task={t} />
        </div>
        {range && (t.start || t.end) ? <div className="relative my-auto hidden h-6 rounded bg-track sm:block" aria-hidden><div className={`absolute h-6 min-w-1 rounded ${t.done ? "bg-success-solid" : "bg-primary"}`} style={timelinePosition(t.start, t.end, range)} /></div> : <p className="hidden text-caption text-ink-muted sm:block">Dates not set</p>}
      </li>)}</ul>
      <h3 className="mt-6 text-title">Milestone targets</h3>
      {plan.milestones.length ? <ul className="divide-y divide-line">{plan.milestones.map(m => <li className="grid gap-3 py-4 sm:grid-cols-[minmax(180px,1fr)_2fr] sm:gap-6" key={m.id}>
        <p className="break-words">{m.name} · {date(m.targetOn)} · {MILESTONE_LABELS[m.status]}</p>
        {range ? <div className="relative hidden h-6 bg-track sm:block" aria-hidden><div className="absolute h-6 min-w-1 bg-primary" style={timelinePosition(m.targetOn, m.targetOn, range)} /></div> : null}
      </li>)}</ul> : <p className="mt-2 text-body-ui text-ink-muted">No milestones yet.</p>}
    </>}
  </Card>;
}
