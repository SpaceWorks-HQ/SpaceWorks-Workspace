"use client";

import { useState } from "react";
import Link from "next/link";

import { addDependencyAction, removeDependencyAction } from "@/app/actions/tasks";
import { Button, IconButton } from "@/components/ui/button";
import { Chip } from "@/components/ui/display";
import { Dropdown, Input } from "@/components/ui/field";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import type { TaskDetailDTO, TaskRef } from "@/lib/tasks/types";
import type { RunAction } from "./useTaskRunner";

function RefRow({ slug, item, onRemove, removeLabel }: { slug: string; item: TaskRef; onRemove?: () => void; removeLabel: string }) {
  const done = Boolean(item.completedAt);
  return (
    <li className="flex min-h-11 items-center gap-2.5 px-3 py-1.5">
      <Link href={taskUrl(slug, item.projectKey, item.number)} className="min-w-0 flex-1 truncate text-body-ui text-ink underline-offset-4 hover:underline">
        <span className="mr-2 text-caption font-semibold tabular-nums text-ink-muted">{taskReference(item.projectKey, item.number)}</span>
        {item.title}
      </Link>
      <Chip size="sm" tone={done ? "success" : item.archivedAt ? "outline" : "neutral"}>
        {done ? "Done" : item.archivedAt ? "Archived" : "Open"}
      </Chip>
      {onRemove ? (
        <IconButton label={removeLabel} size="sm" onClick={onRemove}>
          <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
        </IconButton>
      ) : null}
    </li>
  );
}

/** "Blocked by" and "Blocks" lists plus a small form to link another task by its reference. */
export function TaskDependencies({ slug, task, run }: { slug: string; task: TaskDetailDTO; run: RunAction }) {
  const [direction, setDirection] = useState<"blockedBy" | "blocks">("blockedBy");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const canEdit = task.permissions.canEdit && !task.archivedAt;
  const empty = task.blockedBy.length === 0 && task.blocks.length === 0;
  if (empty && !canEdit) return null;

  const add = async () => {
    setBusy(true);
    const ok = await run(() => addDependencyAction(slug, { taskId: task.id, reference, direction }), "Linked.");
    setBusy(false);
    if (ok) setReference("");
  };

  return (
    <section aria-labelledby={`deps-${task.id}`} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`deps-${task.id}`} className="text-title text-ink">
          Dependencies
        </h3>
        {canEdit && !open ? (
          <Button variant="ghost" size="sm" startIcon={null} onClick={() => setOpen(true)}>
            Link a task
          </Button>
        ) : null}
      </div>
      {task.blockedBy.length ? (
        <div>
          <p className="mb-1.5 text-overline text-ink-muted">Blocked by</p>
          <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
            {task.blockedBy.map((item) => (
              <RefRow
                key={item.id}
                slug={slug}
                item={item}
                removeLabel={`Remove blocker ${taskReference(item.projectKey, item.number)}`}
                onRemove={canEdit ? () => void run(() => removeDependencyAction(slug, { blockingTaskId: item.id, blockedTaskId: task.id })) : undefined}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {task.blocks.length ? (
        <div>
          <p className="mb-1.5 text-overline text-ink-muted">Blocks</p>
          <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
            {task.blocks.map((item) => (
              <RefRow
                key={item.id}
                slug={slug}
                item={item}
                removeLabel={`Stop blocking ${taskReference(item.projectKey, item.number)}`}
                onRemove={canEdit ? () => void run(() => removeDependencyAction(slug, { blockingTaskId: task.id, blockedTaskId: item.id })) : undefined}
              />
            ))}
          </ul>
        </div>
      ) : null}
      {empty && !open ? <p className="text-body-ui text-ink-muted">No dependencies. Link tasks that have to happen in order.</p> : null}
      {open ? (
        <form
          className="grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Dropdown aria-label="Link type" value={direction} onChange={(event) => setDirection(event.target.value as "blockedBy" | "blocks")}>
            <option value="blockedBy">Blocked by</option>
            <option value="blocks">Blocks</option>
          </Dropdown>
          <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={task.project ? `${task.project.key}-12` : "#12"} aria-label="Task reference" maxLength={30} autoFocus />
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!reference.trim()}>
              Link
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
