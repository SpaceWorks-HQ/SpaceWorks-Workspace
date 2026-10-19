"use client";

import { Checkbox } from "@/components/ui/choice";
import { Chip, EmptyState } from "@/components/ui/display";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { groupTasks, sortTasks, type GroupKey, type SortKey } from "@/lib/tasks/filters";
import { taskReference } from "@/lib/tasks/links";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { AvatarStack, BlockedChip, DueChip, LabelChips, PriorityChip } from "./bits";

/** Sortable, groupable table of the board's tasks. */
export function ListView({
  data,
  tasks,
  sort,
  group,
  timeZone,
  onOpen,
  onComplete,
}: {
  data: BoardData;
  tasks: BoardTask[];
  sort: SortKey;
  group: GroupKey;
  timeZone: string;
  onOpen: (number: number) => void;
  onComplete: (task: BoardTask, completed: boolean) => void;
}) {
  const now = new Date();
  const groups = groupTasks(sortTasks(tasks, sort), group, { columns: data.columns, members: data.members, labels: data.labels, now, timeZone });
  const canEdit = data.permissions.canEdit;
  if (tasks.length === 0) return <EmptyState title="No tasks match.">Try clearing a filter.</EmptyState>;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((section) => (
        <section key={section.key} aria-label={section.label} className="flex flex-col gap-2">
          {group !== "none" ? (
            <h3 className="flex items-center gap-2 text-title text-ink">
              {section.label}
              <span className="text-caption tabular-nums text-ink-muted">{section.tasks.length}</span>
            </h3>
          ) : null}
          {section.tasks.length === 0 ? (
            <p className="text-body-ui text-ink-muted">Nothing here.</p>
          ) : (
            <Table label={`${section.label} tasks`}>
              <THead>
                <tr>
                  <TH className="w-12">
                    <span className="sr-only">Done</span>
                  </TH>
                  <TH>Task</TH>
                  <TH>Status</TH>
                  <TH>Priority</TH>
                  <TH>Assignees</TH>
                  <TH>Due</TH>
                </tr>
              </THead>
              <TBody>
                {section.tasks.map((task) => {
                  const reference = taskReference(data.project.key, task.number);
                  const column = data.columns.find((item) => item.id === task.columnId);
                  const people = task.assigneeIds.map((id) => data.members.find((member) => member.id === id) ?? { id, name: "Former member", image: null });
                  return (
                    <TR key={`${section.key}-${task.id}`}>
                      <TD>
                        <Checkbox checked={Boolean(task.completedAt)} disabled={!canEdit} aria-label={`${task.completedAt ? "Reopen" : "Complete"} ${reference}`} onCheckedChange={(checked) => onComplete(task, checked === true)} />
                      </TD>
                      <TD className="min-w-[260px]">
                        <button type="button" onClick={() => onOpen(task.number)} className="flex flex-col items-start gap-1 text-left">
                          <span className={cn("font-medium text-ink underline-offset-4 hover:underline", task.completedAt && "text-ink-muted line-through")}>
                            <span className="mr-2 text-caption font-semibold tabular-nums text-ink-muted">{reference}</span>
                            {task.title}
                          </span>
                          {task.labelIds.length || (task.blocked && !task.completedAt) ? (
                            <span className="flex flex-wrap gap-1">
                              {task.blocked && !task.completedAt ? <BlockedChip /> : null}
                              <LabelChips labelIds={task.labelIds} labels={data.labels} />
                            </span>
                          ) : null}
                        </button>
                      </TD>
                      <TD className="whitespace-nowrap">{column ? <Chip size="sm" tone={column.category === "DONE" ? "success" : column.category === "IN_PROGRESS" ? "info" : "neutral"}>{column.name}</Chip> : "—"}</TD>
                      <TD>{task.priority === "NONE" ? <span className="text-ink-muted">—</span> : <PriorityChip priority={task.priority} />}</TD>
                      <TD>{people.length ? <AvatarStack people={people} /> : <span className="text-ink-muted">—</span>}</TD>
                      <TD className="whitespace-nowrap">{task.dueAt ? <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={timeZone} now={now} /> : <span className="text-ink-muted">—</span>}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </section>
      ))}
    </div>
  );
}
