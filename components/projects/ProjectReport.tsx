"use client";
import Link from "next/link";
import { EmptyState } from "@/components/ui/display";
import { Button } from "@/components/ui/button";
import { HEALTH_LABELS, MILESTONE_LABELS } from "@/lib/projects/plusLogic";
import { formatDate } from "@/lib/format/datetime";
import type { ProjectPlan } from "@/lib/projects/plusTypes";
import styles from "./ProjectReport.module.css";

export function ProjectReport({ plan, generatedAt }: { plan: ProjectPlan; generatedAt: string }) {
  return <article className={`${styles.report} space-y-6 rounded-xl border border-line bg-panel p-5 [overflow-wrap:anywhere]`} aria-label="Project report">
    <header className="space-y-2"><p className="text-caption text-ink-muted">Space Works · Internal project report · {formatDate(generatedAt, plan.timeZone)}</p><h2 className="text-h2">{plan.name} ({plan.key})</h2>
      <p>Lead: {plan.lead} · {plan.progress.percent}% complete ({plan.progress.done}/{plan.progress.total} top-level tasks)</p>
      <p>Health: {plan.updates[0] ? HEALTH_LABELS[plan.updates[0].status] : "No update yet"}</p>
      <div className="flex flex-wrap gap-2 print:hidden"><Button onClick={() => window.print()}>Print report</Button><Button variant="secondary" asChild><a href={`${plan.base}/report/export`}>Download CSV</a></Button><Button variant="quiet" asChild><Link href={`${plan.base}/overview`}>Project overview</Link></Button></div>
    </header>
    {!plan.tasks.length && !plan.milestones.length && !plan.updates.length ? <EmptyState patch title="No project activity yet. Add a task to start the report." action={<Button asChild><Link href={plan.base}>View tasks</Link></Button>} /> : null}
    <section className="space-y-3"><h3 className="text-title">Milestones</h3>{plan.milestones.length ? <ul className="divide-y divide-line">{plan.milestones.map(m => <li className="py-2" key={m.id}><p>{m.name} · {MILESTONE_LABELS[m.status]} · Target {formatDate(`${m.targetOn}T00:00:00Z`, "UTC")}</p><p className="text-caption">{m.tasks.filter(t => t.done).length}/{m.tasks.length} linked tasks done</p>{m.notes ? <p className="whitespace-pre-wrap">{m.notes}</p> : null}</li>)}</ul> : <p>No milestones yet.</p>}</section>
    <section className="space-y-3"><h3 className="text-title">Overdue tasks</h3>{plan.tasks.some(t => t.overdue) ? <ul className="divide-y divide-line">{plan.tasks.filter(t => t.overdue).map(t => <li key={t.id} className="py-2"><Link className="underline" href={t.url}>{t.reference}: {t.title}</Link><p>Due {t.end ? formatDate(`${t.end}T00:00:00Z`, "UTC") : "Not set"} · {t.owner}</p></li>)}</ul> : <p>No overdue tasks.</p>}</section>
    <section className="space-y-3"><h3 className="text-title">Recent updates</h3>{plan.updates.length ? <ol className="divide-y divide-line">{plan.updates.slice(0, 8).map(u => <li className="space-y-2 py-3" key={u.id}><p className="font-semibold">{HEALTH_LABELS[u.status]} · {formatDate(u.createdAt, plan.timeZone)} · {u.author}</p><p className="whitespace-pre-wrap">{u.note}</p>{u.blockers.length ? <p>Blockers: {u.blockers.join("; ")}</p> : null}{u.nextSteps.length ? <p>Next steps: {u.nextSteps.join("; ")}</p> : null}</li>)}</ol> : <p>No updates yet.</p>}</section>
  </article>;
}
