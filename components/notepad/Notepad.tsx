"use client";

import { useCallback, useRef, useState } from "react";
import { loadNotepadAction } from "@/app/actions/notepad";
import { useRealtime } from "@/components/realtime/useRealtime";
import { SegmentedControl } from "@/components/ui/choice";
import type { NoteDTO, NotepadData, TodoDTO } from "@/lib/notepad/service";
import { NoteGrid } from "./NoteGrid";
import { TodoList } from "./TodoList";

/**
 * The personal notepad: a to-do list beside a board of notes. Other tabs of
 * the same member stay in step through the member's own realtime stream.
 */
export function Notepad({ slug, timeZone, initial, initialOpenId, canSendToTasks }: { slug: string; timeZone: string; initial: NotepadData; initialOpenId: string | null; canSendToTasks: boolean }) {
  const [today, setToday] = useState(initial.today);
  const [todos, setTodos] = useState<TodoDTO[]>(initial.todos);
  const [notes, setNotes] = useState<NoteDTO[]>([...initial.notes, ...initial.archivedNotes]);
  const [mobileView, setMobileView] = useState<"todo" | "notes">(initialOpenId ? "notes" : "todo");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const next = await loadNotepadAction(slug).catch(() => null);
    if (!next) return;
    setToday(next.today);
    setTodos(next.todos);
    setNotes([...next.notes, ...next.archivedNotes]);
  }, [slug]);

  useRealtime(
    slug,
    useCallback(
      (event) => {
        if (event.type !== "notepad.changed") return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void reload(), 800);
      },
      [reload],
    ),
  );

  const live = notes.filter((note) => !note.archived);
  const archived = notes.filter((note) => note.archived);
  const openTodos = todos.filter((todo) => !todo.done).length;

  const todoPanel = <TodoList slug={slug} today={today} todos={todos} canSendToTasks={canSendToTasks} onChange={setTodos} onReload={() => void reload()} />;
  const notesPanel = <NoteGrid slug={slug} timeZone={timeZone} notes={live} archivedNotes={archived} initialOpenId={initialOpenId} onChange={setNotes} />;

  return (
    <>
      <div className="lg:hidden">
        <SegmentedControl
          ariaLabel="Notepad section"
          value={mobileView}
          onValueChange={setMobileView}
          options={[
            { value: "todo", label: `To-do${openTodos ? ` (${openTodos})` : ""}` },
            { value: "notes", label: `Notes${live.length ? ` (${live.length})` : ""}` },
          ]}
          className="w-full [&>*]:flex-1"
        />
        <div className="mt-4">{mobileView === "todo" ? todoPanel : notesPanel}</div>
      </div>
      <div className="hidden gap-6 lg:grid lg:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] lg:items-start">
        <div className="lg:sticky lg:top-6">{todoPanel}</div>
        {notesPanel}
      </div>
    </>
  );
}
