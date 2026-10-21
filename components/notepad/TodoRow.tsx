"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Ellipsis } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/choice";
import { Chip } from "@/components/ui/display";
import { Input } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { addDays, dueLabel } from "@/lib/notepad/dates";
import type { TodoDTO } from "@/lib/notepad/service";

export function TodoRow({
  todo,
  today,
  canSendToTasks,
  onToggle,
  onRename,
  onDue,
  onStar,
  onMove,
  onDelete,
  onSendToTasks,
}: {
  todo: TodoDTO;
  today: string;
  canSendToTasks: boolean;
  onToggle: (done: boolean) => void;
  onRename: (text: string) => void;
  onDue: (dueOn: string | null) => void;
  onStar: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onSendToTasks: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(todo.text);
  const overdue = !todo.done && todo.dueOn !== null && todo.dueOn < today;
  const commit = () => {
    setEditing(false);
    const next = text.trim();
    if (next && next !== todo.text) onRename(next);
    else setText(todo.text);
  };

  return (
    <li
      className="group flex min-h-11 items-center gap-3 rounded-lg px-1.5 py-1 transition-colors duration-[120ms] hover:bg-muted focus-within:bg-muted"
      onKeyDown={(event) => {
        if (!event.altKey || editing) return;
        if (event.key === "ArrowUp") {
          event.preventDefault();
          onMove(-1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          onMove(1);
        }
      }}
    >
      <Checkbox checked={todo.done} onCheckedChange={(value) => onToggle(value === true)} aria-label={todo.done ? `Mark “${todo.text}” not done` : `Mark “${todo.text}” done`} />
      <div className="min-w-0 flex-1">
        {editing ? (
          <Input
            autoFocus
            value={text}
            maxLength={500}
            aria-label="Edit to-do"
            onChange={(event) => setText(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
              if (event.key === "Escape") {
                setText(todo.text);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button
            type="button"
            disabled={todo.done}
            onClick={() => setEditing(true)}
            className={cn("block w-full truncate text-left text-body-ui transition-colors duration-[120ms]", todo.done ? "text-ink-muted line-through" : "text-ink")}
            title="Edit"
          >
            {todo.text}
          </button>
        )}
      </div>
      {todo.taskUrl ? (
        <Link href={todo.taskUrl} className="inline-flex shrink-0 items-center gap-1 text-caption font-semibold text-accent-text underline-offset-4 hover:underline">
          Task <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      ) : null}
      {todo.dueOn && !todo.done ? <Chip size="sm" tone={overdue ? "danger" : todo.dueOn === today ? "warning" : "neutral"}>{dueLabel(todo.dueOn, today)}</Chip> : null}
      {!todo.done ? (
        <button
          type="button"
          onClick={onStar}
          aria-pressed={todo.starred}
          className={cn("grid min-h-11 min-w-11 px-2 shrink-0 place-items-center rounded-md transition-colors duration-[120ms] hover:bg-panel", todo.starred ? "text-ink" : "text-ink-muted opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100")}
        >
          <span className="inline-flex items-center justify-center text-xs font-semibold">{todo.starred ? "Unstar" : "Star"}</span>
        </button>
      ) : null}
      <Menu>
        <MenuTrigger asChild>
          <IconButton label="To-do options" variant="quiet" size="sm">
            <Ellipsis aria-hidden className="size-4" />
          </IconButton>
        </MenuTrigger>
        <MenuContent align="end">
          {!todo.done ? (
            <>
              <MenuItem onSelect={() => onDue(today)}>Due today</MenuItem>
              <MenuItem onSelect={() => onDue(addDays(today, 1))}>Due tomorrow</MenuItem>
              <MenuItem onSelect={() => onDue(addDays(today, 7))}>Due in a week</MenuItem>
              {todo.dueOn ? <MenuItem onSelect={() => onDue(null)}>No date</MenuItem> : null}
              <MenuSeparator />
              <MenuItem onSelect={() => onMove(-1)}>Move up</MenuItem>
              <MenuItem onSelect={() => onMove(1)}>Move down</MenuItem>
              {canSendToTasks && !todo.taskId ? (
                <>
                  <MenuSeparator />
                  <MenuItem onSelect={onSendToTasks}>Send to my tasks</MenuItem>
                </>
              ) : null}
              <MenuSeparator />
            </>
          ) : null}
          <MenuItem onSelect={onDelete} danger>Delete</MenuItem>
        </MenuContent>
      </Menu>
    </li>
  );
}
