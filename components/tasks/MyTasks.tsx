"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { loadMyTasksAction, setTaskCompletedAction } from "@/app/actions/tasks";
import { useToast } from "@/components/feedback/ToastProvider";
import { useRealtime } from "@/components/realtime/useRealtime";
import { Checkbox } from "@/components/ui/choice";
import { EmptyState } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import { DUE_BUCKETS, dueBucket } from "@/lib/tasks/due";
import { PRIORITY_RANK } from "@/lib/tasks/filters";
import { taskReference } from "@/lib/tasks/links";
import type { LabelRef, MyTaskDTO } from "@/lib/tasks/types";
import { BlockedChip, DueChip, LabelChips, PriorityChip } from "./bits";
import { TaskDrawer } from "./TaskDrawer";

/**
 * Everything assigned to me, grouped by due date (overdue, today, this
 * week, later, no date). Ticking a task completes it at once; it stays
 * in place, struck through, so a mis-tap is one more tap to undo.
 */
export function MyTasks({ slug, initial, labels, timeZone, projectsHref }: { slug: string; initial: MyTaskDTO[]; labels: LabelRef[]; timeZone: string; projectsHref: string }) {
  const [tasks, setTasks] = useState(initial);
  const [open, setOpen] = useState<number | null>(null);
  const { showToast } = useToast();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const next = await loadMyTasksAction(slug);
    if (next) setTasks(next);
  }, [slug]);

  useRealtime(
    slug,
    useCallback(
      (event) => {
        if (!event.channel.startsWith("project:") && !event.channel.startsWith("user:")) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void reload(), 400);
      },
      [reload],
    ),
  );

  const now = useMemo(() => new Date(), []);
  const groups = useMemo(() => {
    const open = tasks.filter((task) => !task.completedAt);
    const sorted = [...tasks].sort((a, b) => {
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const db = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return da - db || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.number - a.number;
    });
    return {
      openCount: open.length,
      sections: DUE_BUCKETS.map((bucket) => ({ ...bucket, tasks: sorted.filter((task) => dueBucket(task.dueAt, now, timeZone) === bucket.key) })).filter((section) => section.tasks.length > 0),
    };
  }, [tasks, now, timeZone]);

  const toggle = async (task: MyTaskDTO, completed: boolean) => {
    const before = tasks;
    setTasks((list) => list.map((item) => (item.id === task.id ? { ...item, completedAt: completed ? new Date().toISOString() : null } : item)));
    const reference = taskReference(task.projectKey, task.number);
    try {
      const result = await setTaskCompletedAction(slug, { taskId: task.id, completed });
      if (!result.ok) {
        setTasks(before);
        showToast(result.error, "error");
        return;
      }
      showToast(completed ? `${reference} done. Nice work.` : `${reference} reopened.`, "success", completed ? { label: "Undo", onClick: () => void toggle({ ...task, completedAt: new Date().toISOString() }, false) } : null);
    } catch {
      setTasks(before);
      showToast("Couldn't save. Try again.", "error");
    }
  };

  if (tasks.length === 0) {
    return (
      <EmptyState patch title="Nothing assigned to you right now." action={<Link href={projectsHref} className="font-semibold text-ink underline underline-offset-4">Browse projects</Link>}>
        Pick something up from a project board.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <p className="text-body-ui text-ink-secondary" aria-live="polite">
        {groups.openCount === 0 ? "All done. Enjoy the build night." : `${groups.openCount} open ${groups.openCount === 1 ? "task" : "tasks"}.`}
      </p>
      {groups.sections.map((section) => (
        <section key={section.key} aria-labelledby={`bucket-${section.key}`} className="flex flex-col gap-2">
          <h2 id={`bucket-${section.key}`} className={cn("flex items-center gap-2 text-h4", section.key === "overdue" ? "text-danger-fg" : "text-ink")}>
            {section.label}
            <span className="text-caption tabular-nums text-ink-muted">{section.tasks.length}</span>
          </h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
            {section.tasks.map((task) => {
              const reference = taskReference(task.projectKey, task.number);
              const done = Boolean(task.completedAt);
              return (
                <li key={task.id} className="flex min-h-14 items-start gap-3 px-4 py-3">
                  <Checkbox className="mt-0.5" checked={done} aria-label={`${done ? "Reopen" : "Complete"} ${reference} ${task.title}`} onCheckedChange={(checked) => void toggle(task, checked === true)} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => setOpen(task.number)} className={cn("text-left text-body-ui font-medium text-ink underline-offset-4 hover:underline", done && "text-ink-muted line-through")}>
                      {task.title}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-caption text-ink-muted">
                      <span className="font-semibold tabular-nums">{reference}</span>
                      {task.projectName ? <span>· {task.projectName}</span> : null}
                      {task.blocked && !done ? <BlockedChip /> : null}
                      <PriorityChip priority={task.priority} />
                      <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={timeZone} now={now} />
                      <LabelChips labelIds={task.labelIds} labels={labels} max={2} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <TaskDrawer slug={slug} number={open} onClose={() => setOpen(null)} onChanged={reload} />
    </div>
  );
}
