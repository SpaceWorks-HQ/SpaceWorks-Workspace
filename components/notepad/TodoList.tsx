"use client";

import { useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import {
  clearDoneTodosAction,
  createTodoAction,
  deleteTodoAction,
  moveTodoAction,
  sendTodoToTasksAction,
  updateTodoAction,
} from "@/app/actions/notepad";
import { Patch } from "@/components/brand/Patch";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/display";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { addDays, dueLabel, parseQuickTodo, TODO_BUCKETS, todoBucket, type TodoBucket } from "@/lib/notepad/dates";
import type { TodoDTO } from "@/lib/notepad/service";
import { TodoRow } from "./TodoRow";

type Props = {
  slug: string;
  today: string;
  todos: TodoDTO[];
  canSendToTasks: boolean;
  onChange: (update: (todos: TodoDTO[]) => TodoDTO[]) => void;
  onReload: () => void;
};

export function TodoList({ slug, today, todos, canSendToTasks, onChange, onReload }: Props) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => (draft.trim() ? parseQuickTodo(draft, today) : null), [draft, today]);

  const sections = useMemo(() => {
    const ordered = [...todos].sort((a, b) => Number(b.starred) - Number(a.starred) || a.position - b.position);
    return TODO_BUCKETS.map((bucket) => ({ ...bucket, items: ordered.filter((todo) => todoBucket(todo, today) === bucket.key) }));
  }, [todos, today]);

  const dueToday = sections.filter((s) => s.key === "overdue" || s.key === "today").flatMap((s) => s.items);
  const doneToday = todos.filter((todo) => todo.done && todo.doneAt && todo.doneAt.slice(0, 10) >= addDays(today, -1)).length;
  const openCount = todos.filter((todo) => !todo.done).length;
  const allClear = openCount === 0 && todos.length > 0;

  const fail = (message: string) => {
    showToast(message, "error");
    onReload();
  };

  async function add() {
    const parsed = parseQuickTodo(draft, today);
    if (!parsed.text) return;
    setAdding(true);
    try {
      const result = await createTodoAction(slug, parsed);
      if (!result.ok) return fail(result.error);
      onChange((list) => [result.data!, ...list]);
      setDraft("");
      inputRef.current?.focus();
    } catch {
      fail("Couldn't save. Try again.");
    } finally {
      setAdding(false);
    }
  }

  async function patch(todo: TodoDTO, changes: Partial<Pick<TodoDTO, "text" | "dueOn" | "starred" | "done">>, toast?: string) {
    onChange((list) => list.map((item) => (item.id === todo.id ? { ...item, ...changes, doneAt: changes.done === undefined ? item.doneAt : changes.done ? new Date().toISOString() : null } : item)));
    try {
      const result = await updateTodoAction(slug, { id: todo.id, ...changes });
      if (!result.ok) return fail(result.error);
      if (toast) showToast(toast, "success", changes.done ? { label: "Undo", onClick: () => void patch({ ...todo, done: true }, { done: false }) } : null);
    } catch {
      fail("Couldn't save. Try again.");
    }
  }

  async function remove(todo: TodoDTO) {
    onChange((list) => list.filter((item) => item.id !== todo.id));
    const result = await deleteTodoAction(slug, { id: todo.id }).catch(() => null);
    if (!result?.ok) fail(result?.error ?? "Couldn't delete. Try again.");
  }

  async function move(todo: TodoDTO, direction: -1 | 1, list: TodoDTO[]) {
    const index = list.findIndex((item) => item.id === todo.id);
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const reordered = [...list];
    reordered.splice(index, 1);
    reordered.splice(target, 0, todo);
    const before = reordered[target - 1] ?? null;
    const after = reordered[target + 1] ?? null;
    const position = before && after ? (before.position + after.position) / 2 : before ? before.position + 1024 : (after?.position ?? 0) - 1024;
    onChange((all) => all.map((item) => (item.id === todo.id ? { ...item, position } : item)));
    const result = await moveTodoAction(slug, { id: todo.id, beforeId: before?.id ?? null, afterId: after?.id ?? null }).catch(() => null);
    if (!result?.ok) fail(result?.error ?? "Couldn't move it. Try again.");
  }

  async function sendToTasks(todo: TodoDTO) {
    const result = await sendTodoToTasksAction(slug, { id: todo.id }).catch(() => null);
    if (!result?.ok) return fail(result?.error ?? "Couldn't create the task. Try again.");
    onChange((list) => list.map((item) => (item.id === todo.id ? result.data! : item)));
    showToast("Added to your tasks.", "success", result.data?.taskUrl ? { label: "Open", onClick: () => window.location.assign(result.data!.taskUrl!) } : null);
  }

  async function clearDone() {
    const result = await clearDoneTodosAction(slug).catch(() => null);
    if (!result?.ok) return fail(result?.error ?? "Couldn't clear them. Try again.");
    onChange((list) => list.filter((item) => !item.done));
    showToast(`Cleared ${result.data?.cleared ?? 0} done to-dos.`, "success");
  }

  return (
    <section aria-labelledby="todo-heading" className="flex flex-col gap-4 rounded-xl border border-line bg-panel p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id="todo-heading" className="text-h4 text-ink">To-do</h2>
        {dueToday.length + doneToday > 0 ? (
          <span className="text-caption text-ink-muted tabular-nums">{doneToday} done · {dueToday.length} due</span>
        ) : null}
      </div>
      {dueToday.length + doneToday > 0 ? <ProgressBar value={doneToday} max={doneToday + dueToday.length} tone="accent" label="Today's progress" /> : null}

      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label htmlFor="todo-quick-add" className="sr-only">Add a to-do</label>
        <div className="flex gap-2">
          <Input
            id="todo-quick-add"
            ref={inputRef}
            value={draft}
            maxLength={500}
            autoComplete="off"
            placeholder="Add a to-do. Try “tomorrow”, “fri” or “!”"
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" variant="primary" disabled={adding || !preview?.text} aria-label="Add to-do">
            <Plus aria-hidden className="size-4" />
            <span className="hidden sm:inline">Add</span>
          </Button>
        </div>
        <p className="min-h-5 text-caption text-ink-muted" aria-live="polite">
          {preview?.dueOn ? `Due ${dueLabel(preview.dueOn, today).toLowerCase()}` : ""}
          {preview?.dueOn && preview.starred ? " · " : ""}
          {preview?.starred ? "Starred" : ""}
        </p>
      </form>

      {todos.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <Patch size={96} />
          <p className="text-label text-ink">Your list is empty.</p>
          <p className="max-w-xs text-body-ui text-ink-muted">Jot the small stuff here. Only you can see it.</p>
        </div>
      ) : allClear ? (
        <div className="flex flex-col items-center gap-2 py-3 text-center">
          <Patch pose="walk" size={128} />
          <p className="text-label text-ink">All clear.</p>
          <p className="text-body-ui text-ink-muted">Patch is off to fetch the next one.</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        {sections
          .filter((section) => section.key !== "done" && section.items.length > 0)
          .map((section) => (
            <TodoSection key={section.key} bucket={section.key} label={section.label} count={section.items.length}>
              {section.items.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  today={today}
                  canSendToTasks={canSendToTasks}
                  onToggle={(done) => void patch(todo, { done }, done ? "Done. Nice one." : undefined)}
                  onRename={(text) => void patch(todo, { text })}
                  onDue={(dueOn) => void patch(todo, { dueOn })}
                  onStar={() => void patch(todo, { starred: !todo.starred })}
                  onMove={(direction) => void move(todo, direction, section.items)}
                  onDelete={() => void remove(todo)}
                  onSendToTasks={() => void sendToTasks(todo)}
                />
              ))}
            </TodoSection>
          ))}
      </div>

      {sections.find((s) => s.key === "done")!.items.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <div className="flex items-center justify-between">
            <button type="button" className="text-label text-ink-secondary underline-offset-4 hover:underline" aria-expanded={showDone} onClick={() => setShowDone((value) => !value)}>
              {showDone ? "Hide done" : `Show done (${sections.find((s) => s.key === "done")!.items.length})`}
            </button>
            {showDone ? <Button variant="quiet" size="sm" onClick={() => void clearDone()}>Clear done</Button> : null}
          </div>
          {showDone ? (
            <ul className="flex flex-col">
              {sections.find((s) => s.key === "done")!.items.map((todo) => (
                <TodoRow key={todo.id} todo={todo} today={today} canSendToTasks={false} onToggle={(done) => void patch(todo, { done })} onRename={() => undefined} onDue={() => undefined} onStar={() => undefined} onMove={() => undefined} onDelete={() => void remove(todo)} onSendToTasks={() => undefined} />
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function TodoSection({ bucket, label, count, children }: { bucket: TodoBucket; label: string; count: number; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className={cn("flex items-center gap-2 text-eyebrow uppercase tracking-[0.08em]", bucket === "overdue" ? "text-danger-fg" : "text-ink-muted")}>
        {label} <span className="tabular-nums">{count}</span>
      </h3>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}
