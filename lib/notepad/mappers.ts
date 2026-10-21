import "server-only";
import type { PersonalNote, PersonalTodo } from "@prisma/client";
import type { NoteDTO, TodoDTO } from "./service";

/* ---------- Mapping ---------- */

function checklistCounts(html: string) {
  const total = (html.match(/data-type="taskItem"/g) ?? []).length;
  const done = (html.match(/data-type="taskItem"[^>]*data-checked="true"|data-checked="true"[^>]*data-type="taskItem"/g) ?? []).length;
  return { done, total };
}

export function noteDTO(note: PersonalNote): NoteDTO {
  return {
    id: note.id,
    title: note.title,
    contentHtml: note.contentHtml,
    excerpt: note.contentText.slice(0, 280),
    tone: note.tone,
    pinned: note.pinned,
    archived: Boolean(note.archivedAt),
    checklist: checklistCounts(note.contentHtml),
    updatedAt: note.updatedAt.toISOString(),
  };
}

export function todoDTO(todo: PersonalTodo & { task?: { number: number; project: { key: string } | null } | null }, slug: string): TodoDTO {
  return {
    id: todo.id,
    text: todo.text,
    done: todo.done,
    doneAt: todo.doneAt?.toISOString() ?? null,
    dueOn: todo.dueOn ? todo.dueOn.toISOString().slice(0, 10) : null,
    starred: todo.starred,
    position: todo.position,
    noteId: todo.noteId,
    taskId: todo.taskId,
    taskUrl: todo.task ? (todo.task.project ? `/w/${slug}/projects/${todo.task.project.key}/${todo.task.number}` : `/w/${slug}/t/${todo.task.number}`) : null,
  };
}
