"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { createTaskAction, loadBoardAction, moveTaskAction, setTaskCompletedAction } from "@/app/actions/tasks";
import { useRealtime } from "@/components/realtime/useRealtime";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { activeFilterCount, matchesFilters, parseTaskQuery, taskQueryToParams, type TaskQuery } from "@/lib/tasks/filters";
import { taskReference } from "@/lib/tasks/links";
import { placeAt } from "@/lib/tasks/position";
import type { BoardData, BoardTask } from "@/lib/tasks/types";
import { AddColumn, ColumnMenu } from "./ColumnControls";
import { FilterBar } from "./FilterBar";
import { ListView } from "./ListView";
import { TaskCard, type CardMove } from "./TaskCard";
import { TaskDrawer } from "./TaskDrawer";
import { useTaskRunner } from "./useTaskRunner";

const byPosition = (a: BoardTask, b: BoardTask) => a.position - b.position || a.number - b.number;

function QuickAdd({ onCreate }: { onCreate: (title: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <Button variant="quiet" size="sm" startIcon={<Plus />} onClick={() => setOpen(true)} className="justify-start">
        Add task
      </Button>
    );
  }
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        const ok = await onCreate(title.trim());
        setBusy(false);
        if (ok) setTitle("");
      }}
      className="flex flex-col gap-2"
    >
      <Input
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={200}
        placeholder="Task title, then Enter"
        aria-label="New task title"
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!title.trim()}>
          Add
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </form>
  );
}

/**
 * The project board and list. Cards move by drag and drop or with each
 * card's Move menu; changes show immediately and are rolled back if the
 * server refuses. Other people's changes arrive over realtime
 * (`project:<id>`) and trigger a refetch. Filters, view, sorting and the
 * open task live in the URL.
 */
export function ProjectBoard({ slug, initial, viewerId, timeZone }: { slug: string; initial: BoardData; viewerId: string; timeZone: string }) {
  const [data, setData] = useState(initial);
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    // The server re-rendered (e.g. after a column change): take the fresh data.
    setSeen(initial);
    setData(initial);
  }
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseTaskQuery(new URLSearchParams(searchParams.toString())), [searchParams]);
  const openNumber = Number(searchParams.get("task")) || null;
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ columnId: string; index: number } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const dragging = useRef(false);
  const stale = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = data.project.key;
  const projectId = data.project.id;

  const reload = useCallback(async () => {
    const next = await loadBoardAction(slug, key);
    if (next) setData(next);
  }, [slug, key]);
  const run = useTaskRunner(reload);

  useRealtime(
    slug,
    useCallback(
      (event) => {
        if (event.channel !== `project:${projectId}`) return;
        if (dragging.current) {
          stale.current = true;
          return;
        }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void reload(), 250);
      },
      [projectId, reload],
    ),
  );

  useEffect(() => {
    if (!focusId) return;
    const frame = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-card-focus="${focusId}"]`)?.focus();
      setFocusId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, data]);

  const writeUrl = useCallback(
    (next: TaskQuery, task: number | null, push = false) => {
      const params = taskQueryToParams(next);
      if (task) params.set("task", String(task));
      const url = `${pathname}${params.size ? `?${params.toString()}` : ""}`;
      if (push) window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname],
  );

  const context = useMemo(() => ({ userId: viewerId, now: new Date(), timeZone }), [viewerId, timeZone]);
  const visible = useMemo(() => data.tasks.filter((task) => matchesFilters(task, query.filters, context)), [data.tasks, query.filters, context]);
  const columnTasks = useCallback((columnId: string) => visible.filter((task) => task.columnId === columnId).sort(byPosition), [visible]);
  const canEdit = data.permissions.canEdit;
  const filtered = activeFilterCount(query.filters) > 0;

  const applyMove = useCallback(
    async (task: BoardTask, columnId: string, afterTaskId: string | null, success?: string) => {
      const before = data;
      const siblings = data.tasks.filter((item) => item.columnId === columnId && item.id !== task.id).sort(byPosition);
      const index = afterTaskId === null ? 0 : siblings.findIndex((item) => item.id === afterTaskId) + 1 || siblings.length;
      const { position } = placeAt(
        siblings.map((item) => item.position),
        index,
      );
      const column = data.columns.find((item) => item.id === columnId);
      const completedAt = column?.category === "DONE" ? (task.completedAt ?? new Date().toISOString()) : null;
      setData({ ...data, tasks: data.tasks.map((item) => (item.id === task.id ? { ...item, columnId, position, completedAt } : item)) });
      const ok = await run(() => moveTaskAction(slug, { taskId: task.id, columnId, afterTaskId }), success);
      if (!ok) setData(before);
    },
    [data, run, slug],
  );

  const onMove = useCallback(
    (task: BoardTask, move: CardMove) => {
      const reference = taskReference(key, task.number);
      setFocusId(task.id);
      if (move.kind === "column") {
        const column = data.columns.find((item) => item.id === move.columnId);
        void applyMove(task, move.columnId, null, `Moved ${reference} to ${column?.name ?? "the column"}.`);
        return;
      }
      if (!task.columnId) return;
      const list = columnTasks(task.columnId);
      const index = list.findIndex((item) => item.id === task.id);
      const others = list.filter((item) => item.id !== task.id);
      let after: string | null = null;
      if (move.kind === "up") after = index >= 2 ? list[index - 2]!.id : null;
      if (move.kind === "down") after = list[index + 1]?.id ?? others[others.length - 1]?.id ?? null;
      if (move.kind === "top") after = null;
      if (move.kind === "bottom") after = others[others.length - 1]?.id ?? null;
      const label = { up: "up", down: "down", top: "to the top", bottom: "to the bottom" }[move.kind];
      void applyMove(task, task.columnId, after, `Moved ${reference} ${label}.`);
    },
    [applyMove, columnTasks, data.columns, key],
  );

  const onDragStart = useCallback((event: DragEvent<HTMLElement>, task: BoardTask) => {
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.effectAllowed = "move";
    dragging.current = true;
    setDragId(task.id);
  }, []);

  const onDragEnd = useCallback(() => {
    dragging.current = false;
    setDragId(null);
    setDrop(null);
    if (stale.current) {
      stale.current = false;
      void reload();
    }
  }, [reload]);

  const onDragOver = (event: DragEvent<HTMLElement>, columnId: string) => {
    if (!dragId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-card-id]")).filter((el) => el.dataset.cardId !== dragId);
    const found = cards.findIndex((el) => {
      const rect = el.getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2;
    });
    const index = found === -1 ? cards.length : found;
    if (drop?.columnId !== columnId || drop.index !== index) setDrop({ columnId, index });
  };

  const onDrop = (event: DragEvent<HTMLElement>, columnId: string) => {
    event.preventDefault();
    const task = data.tasks.find((item) => item.id === dragId);
    const target = drop && drop.columnId === columnId ? drop.index : null;
    onDragEnd();
    if (!task || target === null) return;
    const list = columnTasks(columnId).filter((item) => item.id !== task.id);
    const after = target > 0 ? list[target - 1]!.id : null;
    if (task.columnId === columnId) {
      const current = columnTasks(columnId);
      const currentIndex = current.findIndex((item) => item.id === task.id);
      if (currentIndex === target) return;
    }
    const column = data.columns.find((item) => item.id === columnId);
    void applyMove(task, columnId, after, task.columnId !== columnId ? `Moved ${taskReference(key, task.number)} to ${column?.name ?? "the column"}.` : undefined);
  };

  const createIn = (columnId: string) => async (title: string) =>
    run(() => createTaskAction(slug, { projectId, columnId, title }), (created) => (created ? `Added ${created.reference}.` : null));

  const openTask = useCallback((number: number) => writeUrl(query, number, true), [query, writeUrl]);
  const closeTask = useCallback(() => writeUrl(query, null), [query, writeUrl]);

  return (
    <div className="flex flex-col gap-5">
      <FilterBar query={query} onChange={(next) => writeUrl(next, openNumber)} members={data.members} labels={data.labels} />
      {data.project.status === "ARCHIVED" ? (
        <Callout tone="info" title="This project is archived.">
          The board is read-only until someone restores it in the project settings.
        </Callout>
      ) : null}
      {filtered ? (
        <p className="text-caption text-ink-muted" aria-live="polite">
          Showing {visible.length} of {data.tasks.length} tasks.
        </p>
      ) : null}

      {query.view === "list" ? (
        <ListView
          data={data}
          tasks={visible}
          sort={query.sort}
          group={query.group}
          timeZone={timeZone}
          onOpen={openTask}
          onComplete={(task, completed) => void run(() => setTaskCompletedAction(slug, { taskId: task.id, completed }), completed ? `${taskReference(key, task.number)} done.` : `${taskReference(key, task.number)} reopened.`)}
        />
      ) : (
        <div className="relative -mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 [scrollbar-width:thin]" role="region" aria-label={`${data.project.name} board`} tabIndex={0}>
          <ol className="flex snap-x snap-mandatory items-start gap-4 sm:snap-none">
            {data.columns.map((column) => {
              const list = columnTasks(column.id);
              const total = data.tasks.filter((task) => task.columnId === column.id).length;
              const others = list.filter((task) => task.id !== dragId);
              const indicatorAt = drop?.columnId === column.id ? drop.index : null;
              return (
                <li key={column.id} className="flex w-[min(85vw,300px)] shrink-0 snap-start flex-col rounded-xl border border-line bg-surface">
                  <div className="flex items-center justify-between gap-2 border-b border-line py-1.5 pl-3.5 pr-1.5">
                    <h2 className="flex min-w-0 items-center gap-2 text-label font-semibold text-ink">
                      <span className="truncate">{column.name}</span>
                      <span className="text-caption tabular-nums text-ink-muted">
                        {filtered ? `${list.length}/${total}` : total}
                        <span className="sr-only"> tasks</span>
                      </span>
                    </h2>
                    {data.permissions.canManage && data.project.status !== "ARCHIVED" ? (
                      <ColumnMenu slug={slug} projectId={projectId} projectKey={key} column={column} columns={data.columns} taskCount={total} run={run} />
                    ) : (
                      <span className="size-9" aria-hidden />
                    )}
                  </div>
                  <div
                    className={cn("flex min-h-24 flex-col gap-2 p-2 transition-colors duration-[120ms]", indicatorAt !== null && "bg-accent-soft")}
                    onDragOver={(event) => onDragOver(event, column.id)}
                    onDrop={(event) => onDrop(event, column.id)}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null) && drop?.columnId === column.id) setDrop(null);
                    }}
                  >
                    {list.map((task) => {
                      const index = others.findIndex((item) => item.id === task.id);
                      return (
                        <div key={task.id} className="flex flex-col gap-2">
                          {indicatorAt !== null && index === indicatorAt && task.id !== dragId ? <div aria-hidden className="h-0.5 rounded-full bg-accent" /> : null}
                          <TaskCard
                            task={task}
                            projectKey={key}
                            columns={data.columns}
                            members={data.members}
                            labels={data.labels}
                            timeZone={timeZone}
                            canEdit={canEdit}
                            dragging={task.id === dragId}
                            position={{ index: list.indexOf(task), count: list.length }}
                            onOpen={openTask}
                            onMove={onMove}
                            onDragStart={onDragStart}
                            onDragEnd={onDragEnd}
                          />
                        </div>
                      );
                    })}
                    {indicatorAt !== null && indicatorAt >= others.length ? <div aria-hidden className="h-0.5 rounded-full bg-accent" /> : null}
                    {list.length === 0 ? <p className="px-1.5 py-3 text-caption text-ink-muted">{filtered && total ? "No matching tasks here." : "Nothing here yet."}</p> : null}
                    {canEdit ? <QuickAdd onCreate={createIn(column.id)} /> : null}
                  </div>
                </li>
              );
            })}
            {data.permissions.canManage && data.project.status !== "ARCHIVED" ? (
              <li className="w-[min(85vw,300px)] shrink-0 snap-start">
                <AddColumn slug={slug} projectId={projectId} projectKey={key} run={run} />
              </li>
            ) : null}
          </ol>
        </div>
      )}
      <TaskDrawer slug={slug} number={openNumber} onClose={closeTask} onChanged={reload} />
    </div>
  );
}
