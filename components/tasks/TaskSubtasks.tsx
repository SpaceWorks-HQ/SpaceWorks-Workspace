"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { createTaskAction, setTaskCompletedAction } from "@/app/actions/tasks";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { ProgressBar } from "@/components/ui/display";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { taskReference, taskUrl } from "@/lib/tasks/links";
import type { TaskDetailDTO } from "@/lib/tasks/types";
import { AvatarStack } from "./bits";
import type { RunAction } from "./useTaskRunner";

export function TaskSubtasks({ slug, task, run }: { slug: string; task: TaskDetailDTO; run: RunAction }) {
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = task.permissions.canEdit && !task.archivedAt;
  const done = task.subtasks.filter((subtask) => subtask.completedAt).length;
  if (task.parent) return null;

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    const ok = await run(() => createTaskAction(slug, { parentId: task.id, title: title.trim() }));
    setBusy(false);
    if (ok) setTitle("");
  };

  return (
    <section aria-labelledby={`subtasks-${task.id}`} className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id={`subtasks-${task.id}`} className="text-title text-ink">
          Subtasks
          {task.subtasks.length ? <span className="ml-2 text-caption tabular-nums text-ink-muted">{done} of {task.subtasks.length} done</span> : null}
        </h3>
        {canEdit && !adding ? (
          <Button variant="ghost" size="sm" startIcon={<Plus />} onClick={() => setAdding(true)}>
            Add subtask
          </Button>
        ) : null}
      </div>
      {task.subtasks.length ? <ProgressBar value={done} max={task.subtasks.length} tone="success" label="Subtask progress" /> : null}
      {task.subtasks.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
          {task.subtasks.map((subtask) => (
            <li key={subtask.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <Checkbox
                checked={Boolean(subtask.completedAt)}
                disabled={!canEdit}
                aria-label={`${subtask.completedAt ? "Reopen" : "Complete"} ${subtask.title}`}
                onCheckedChange={(checked) => void run(() => setTaskCompletedAction(slug, { taskId: subtask.id, completed: checked === true }))}
              />
              <Link href={taskUrl(slug, subtask.projectKey, subtask.number)} className={cn("min-w-0 flex-1 truncate text-body-ui text-ink underline-offset-4 hover:underline", subtask.completedAt && "text-ink-muted line-through")}>
                <span className="mr-2 text-caption font-semibold tabular-nums text-ink-muted no-underline">{taskReference(subtask.projectKey, subtask.number)}</span>
                {subtask.title}
              </Link>
              <AvatarStack people={subtask.assignees} max={2} />
            </li>
          ))}
        </ul>
      ) : !adding ? (
        <p className="text-body-ui text-ink-muted">Break it into smaller steps when it helps.</p>
      ) : null}
      {adding ? (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="What's the next step?" aria-label="Subtask title" onKeyDown={(event) => event.key === "Escape" && setAdding(false)} />
          <div className="flex shrink-0 gap-2">
            <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!title.trim()}>
              Add
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>
              Done
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
