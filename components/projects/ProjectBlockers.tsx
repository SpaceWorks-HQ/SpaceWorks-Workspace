"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Dropdown } from "@/components/ui/field";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { BlockerDetails } from "./ProjectTimeline";
import { formatDate } from "@/lib/format/datetime";
import type { BlockerRow } from "@/lib/projects/plusTypes";

export function ProjectBlockers({ rows, base }: { rows: BlockerRow[]; base: string }) {
  const [project, setProject] = useState("");
  const [owner, setOwner] = useState("");
  const projects = [...new Map(rows.map(r => [r.projectId, r.projectName])).entries()];
  const owners = [...new Set(rows.map(r => r.owner))].sort();
  const filtered = rows.filter(r => (!project || r.projectId === project) && (!owner || r.owner === owner));
  return <div className="space-y-6 [overflow-wrap:anywhere]">
    <PageHeader title="Project blockers" description="Open tasks waiting on a person, decision or another task. Includes active and paused projects." actions={<Button variant="secondary" asChild><Link href={base}>View projects</Link></Button>} />
    {rows.length ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Project"><Dropdown value={project} onChange={e => setProject(e.target.value)}><option value="">All projects</option>{projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Dropdown></Field><Field label="Follow-up owner"><Dropdown value={owner} onChange={e => setOwner(e.target.value)}><option value="">All owners</option>{owners.map(name => <option key={name}>{name}</option>)}</Dropdown></Field></div> : null}
    <p role="status" className="text-body-ui text-ink-muted">{filtered.length} blocked {filtered.length === 1 ? "task" : "tasks"}</p>
    {filtered.length ? <ul className="space-y-4">{filtered.map(task => <li key={task.id}><Card><div className="space-y-3"><p className="text-caption text-ink-muted">{task.projectName} · Owner: {task.owner} · Due: {task.end ? formatDate(`${task.end}T00:00:00Z`, "UTC") : "Not set"}</p><Link className="inline-flex min-h-11 items-center text-title underline" href={task.url}>{task.reference}: {task.title}</Link><div className="flex flex-wrap gap-2"><Chip tone="warning">Blocked</Chip>{task.overdue ? <Chip tone="danger">Overdue</Chip> : null}</div><BlockerDetails task={task} /><Link className="inline-flex min-h-11 items-center text-accent-text underline" href={task.url}>Review blocker</Link></div></Card></li>)}</ul> : <EmptyState patch title={rows.length ? "No blockers match these filters." : "No blockers. Keep the next step clear on each task."} action={rows.length ? <Button variant="secondary" onClick={() => { setOwner(""); setProject(""); }}>Clear filters</Button> : <Button asChild><Link href={base}>View projects</Link></Button>} />}
  </div>;
}
