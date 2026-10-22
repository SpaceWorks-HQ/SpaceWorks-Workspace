"use client";

import { memo, type DragEvent } from "react";
import { Ellipsis } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { taskReference } from "@/lib/tasks/links";
import type { BoardTask, ColumnDTO, LabelRef, PersonRef } from "@/lib/tasks/types";
import { AvatarStack, BlockedChip, DueChip, LabelChips, PriorityChip, SubtaskProgress } from "./bits";

export type CardMove = { kind: "column"; columnId: string } | { kind: "up" | "down" | "top" | "bottom" };

/**
 * One board card. The card body is a button that opens the task; the
 * "Move" menu beside it is the keyboard (and touch) alternative to drag
 * and drop.
 */
export const TaskCard = memo(function TaskCard({
  task,
  projectKey,
  columns,
  members,
  labels,
  timeZone,
  canEdit,
  dragging,
  position,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}: {
  task: BoardTask;
  projectKey: string;
  columns: ColumnDTO[];
  members: PersonRef[];
  labels: LabelRef[];
  timeZone: string;
  canEdit: boolean;
  dragging: boolean;
  position: { index: number; count: number };
  onOpen: (number: number) => void;
  onMove: (task: BoardTask, move: CardMove) => void;
  onDragStart: (event: DragEvent<HTMLElement>, task: BoardTask) => void;
  onDragEnd: () => void;
}) {
  const reference = taskReference(projectKey, task.number);
  const assignees = task.assigneeIds.map((id) => members.find((member) => member.id === id) ?? { id, name: "Former member", image: null });
  const done = Boolean(task.completedAt);
  return (
    <article
      data-card-id={task.id}
      draggable={canEdit}
      onDragStart={(event) => onDragStart(event, task)}
      onDragEnd={onDragEnd}
      aria-label={`${reference} ${task.title}`}
      className={cn(
        "group relative rounded-xl border border-line bg-panel transition-[background-color,border-color,opacity] duration-[120ms] hover:border-line-strong",
        canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <button
        type="button"
        data-card-focus={task.id}
        onClick={() => onOpen(task.number)}
        className="flex w-full flex-col gap-2 rounded-lg p-3 pr-11 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--yy-focus)]"
      >
        <span className="flex items-center gap-1.5 text-caption font-semibold tabular-nums text-ink-muted">
          {done ? <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">✓</span> : null}
          {reference}
          {task.recurring ? <span className="inline-flex items-center justify-center text-xs font-semibold">Recurring</span> : null}
        </span>
        <span className={cn("break-words text-body-ui font-medium text-ink", done && "text-ink-secondary")}>{task.title}</span>
        {task.labelIds.length || task.priority !== "NONE" || task.blocked || task.dueAt ? (
          <span className="flex flex-wrap gap-1.5">
            {task.blocked && !done ? <BlockedChip /> : null}
            <PriorityChip priority={task.priority} />
            <DueChip dueAt={task.dueAt} completedAt={task.completedAt} timeZone={timeZone} />
            <LabelChips labelIds={task.labelIds} labels={labels} max={2} />
          </span>
        ) : null}
        {assignees.length || task.subtaskCount || task.commentCount || task.attachmentCount ? (
          <span className="flex items-center gap-3 text-caption text-ink-muted">
            <SubtaskProgress done={task.subtaskDone} total={task.subtaskCount} />
            {task.commentCount ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                {task.commentCount}
                <span> comments</span>
              </span>
            ) : null}
            {task.attachmentCount ? (
              <span className="inline-flex items-center gap-1 tabular-nums">
                {task.attachmentCount}
                <span> attachments</span>
              </span>
            ) : null}
            <AvatarStack people={assignees} className="ml-auto" />
          </span>
        ) : null}
      </button>
      {canEdit ? (
        <div className="absolute right-1 top-1">
          <Menu>
            <MenuTrigger asChild>
              <IconButton label={`Move ${reference}`} size="sm">
                <Ellipsis />
              </IconButton>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuLabel>Move to</MenuLabel>
              {columns.map((column) => (
                <MenuItem key={column.id} disabled={column.id === task.columnId} onSelect={() => onMove(task, { kind: "column", columnId: column.id })}>
                  {column.name}
                  {column.id === task.columnId ? <span className="sr-only"> (current)</span> : null}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem disabled={position.index === 0} onSelect={() => onMove(task, { kind: "up" })}>
                Move up
              </MenuItem>
              <MenuItem disabled={position.index >= position.count - 1} onSelect={() => onMove(task, { kind: "down" })}>
                Move down
              </MenuItem>
              <MenuItem disabled={position.index === 0} onSelect={() => onMove(task, { kind: "top" })}>
                Move to top
              </MenuItem>
              <MenuItem disabled={position.index >= position.count - 1} onSelect={() => onMove(task, { kind: "bottom" })}>
                Move to bottom
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ) : null}
    </article>
  );
});
