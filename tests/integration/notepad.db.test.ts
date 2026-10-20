import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  clearDoneTodos,
  createNote,
  createTodo,
  deleteNote,
  deleteTodo,
  getNotepad,
  moveTodo,
  sendTodoToTasks,
  setNoteArchived,
  updateNote,
  updateTodo,
  type NotepadActor,
} from "@/lib/notepad/service";
import { searchDocuments } from "@/lib/search/query";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@notepad-${suffix}.test`;
const slugA = `notepad-a-${suffix}`;
const slugB = `notepad-b-${suffix}`;

let owner: NotepadActor;
let member: NotepadActor;
let guest: NotepadActor;
let elsewhere: NotepadActor;

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<NotepadActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}

const ok = <T>(result: { ok: boolean; data?: T; error?: string }) => {
  if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
  return result.data as T;
};

beforeAll(async () => {
  const ownerUser = await createUser(`owner${domain}`, "Owner");
  const memberUser = await createUser(`member${domain}`, "Meera");
  const guestUser = await createUser(`guest${domain}`, "Guest");
  const a = await createWorkspace(slugA, ownerUser.id);
  const b = await createWorkspace(slugB, memberUser.id);
  await addMember(a.id, memberUser.id, "MEMBER");
  await addMember(a.id, guestUser.id, "GUEST");
  owner = await actorFor(ownerUser.id, a.id, "OWNER");
  member = await actorFor(memberUser.id, a.id, "MEMBER");
  guest = await actorFor(guestUser.id, a.id, "GUEST");
  elsewhere = await actorFor(memberUser.id, b.id, "OWNER");
}, 60_000);

afterAll(async () => {
  await cleanup([slugA, slugB], domain);
}, 60_000);

describe("personal notes", () => {
  it("are visible only to their owner, never to admins or other workspaces", async () => {
    const note = ok(await createNote(member, { title: "Gift ideas", contentHtml: "<p>Soldering kit for Joel</p>", tone: "CITRON" }));
    expect((await getNotepad(member)).notes.map((n) => n.id)).toContain(note.id);
    expect((await getNotepad(owner)).notes.map((n) => n.id)).not.toContain(note.id);
    expect((await getNotepad(elsewhere)).notes.map((n) => n.id)).not.toContain(note.id);

    expect((await updateNote(owner, { id: note.id, title: "Hijacked" })).ok).toBe(false);
    expect((await setNoteArchived(owner, { id: note.id, archived: true })).ok).toBe(false);
    expect((await updateNote(elsewhere, { id: note.id, title: "Hijacked" })).ok).toBe(false);
    expect((await prisma.personalNote.findUniqueOrThrow({ where: { id: note.id } })).title).toBe("Gift ideas");
  });

  it("are found by search for the owner only, admins included", async () => {
    ok(await createNote(member, { title: "Router passwords drawer", contentHtml: "<p>Label maker in the blue drawer</p>" }));
    const search = (actor: NotepadActor) => searchDocuments({ workspaceId: actor.workspace.id, userId: actor.user.id, role: actor.membership.role }, "drawer");
    expect((await search(member)).some((hit) => hit.entityType === "note")).toBe(true);
    expect((await search(owner)).some((hit) => hit.entityType === "note")).toBe(false);
    expect((await search(guest)).some((hit) => hit.entityType === "note")).toBe(false);
  });

  it("sanitise HTML, keep checklists and count them", async () => {
    const note = ok(
      await createNote(member, {
        contentHtml: '<p onclick="steal()">Shopping</p><script>alert(1)</script><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Flux</p></li><li data-type="taskItem" data-checked="false"><p>Wick</p></li></ul>',
      }),
    );
    expect(note.contentHtml).not.toContain("script");
    expect(note.contentHtml).not.toContain("onclick");
    expect(note.checklist).toEqual({ done: 1, total: 2 });
  });

  it("refuse a save from a stale version", async () => {
    const note = ok(await createNote(member, { title: "Draft" }));
    ok(await updateNote(member, { id: note.id, title: "Tab one", expectedUpdatedAt: note.updatedAt }));
    const stale = await updateNote(member, { id: note.id, title: "Tab two", expectedUpdatedAt: note.updatedAt });
    expect(stale.ok).toBe(false);
  });

  it("archive before delete, and leave search when archived", async () => {
    const note = ok(await createNote(member, { title: "Bike lock combination" }));
    expect((await deleteNote(member, { id: note.id })).ok).toBe(false);
    ok(await setNoteArchived(member, { id: note.id, archived: true }));
    expect(await prisma.searchDocument.count({ where: { entityType: "note", entityId: note.id } })).toBe(0);
    ok(await deleteNote(member, { id: note.id }));
    expect(await prisma.personalNote.count({ where: { id: note.id } })).toBe(0);
  });
});

describe("personal to-dos", () => {
  it("are private and ordered newest first", async () => {
    const first = ok(await createTodo(member, { text: "Return the drill" }));
    const second = ok(await createTodo(member, { text: "Order filament", dueOn: "2026-10-21", starred: true }));
    const mine = (await getNotepad(member)).todos.filter((t) => !t.done).map((t) => t.id);
    expect(mine.indexOf(second.id)).toBeLessThan(mine.indexOf(first.id));
    expect((await getNotepad(owner)).todos.map((t) => t.id)).not.toContain(first.id);
    expect((await updateTodo(owner, { id: first.id, done: true })).ok).toBe(false);
    expect((await deleteTodo(owner, { id: first.id })).ok).toBe(false);
  });

  it("complete, reorder and clear", async () => {
    const a = ok(await createTodo(member, { text: "A" }));
    const b = ok(await createTodo(member, { text: "B" }));
    const moved = ok(await moveTodo(member, { id: b.id, beforeId: a.id, afterId: null }));
    expect(moved.position).toBeGreaterThan(a.position);
    const done = ok(await updateTodo(member, { id: a.id, done: true }));
    expect(done.done).toBe(true);
    expect(done.doneAt).not.toBeNull();
    const cleared = ok(await clearDoneTodos(member));
    expect(cleared.cleared).toBeGreaterThanOrEqual(1);
    expect(await prisma.personalTodo.count({ where: { id: a.id } })).toBe(0);
  });

  it("can be sent to the workspace as a task assigned to the member, once", async () => {
    const todo = ok(await createTodo(member, { text: "Fix the laser cutter fan", dueOn: "2026-10-22", starred: true }));
    const sent = ok(await sendTodoToTasks(member, { id: todo.id }));
    expect(sent.taskId).not.toBeNull();
    const task = await prisma.task.findUniqueOrThrow({ where: { id: sent.taskId! }, include: { assignees: true } });
    expect(task.title).toBe("Fix the laser cutter fan");
    expect(task.workspaceId).toBe(member.workspace.id);
    expect(task.assignees.map((a) => a.userId)).toEqual([member.user.id]);
    expect(task.priority).toBe("HIGH");
    expect((await sendTodoToTasks(member, { id: todo.id })).ok).toBe(false);
  });

  it("let guests keep a list but not create workspace tasks", async () => {
    const todo = ok(await createTodo(guest, { text: "Bring safety glasses" }));
    expect((await sendTodoToTasks(guest, { id: todo.id })).ok).toBe(false);
  });

  it("disappear with the workspace", async () => {
    const extra = await createUser(`gone${domain}`, "Gone");
    const temp = await createWorkspace(`notepad-c-${suffix}`, extra.id);
    const actor = await actorFor(extra.id, temp.id, "OWNER");
    ok(await createTodo(actor, { text: "Temporary" }));
    ok(await createNote(actor, { title: "Temporary" }));
    await prisma.workspace.delete({ where: { id: temp.id } });
    expect(await prisma.personalTodo.count({ where: { workspaceId: temp.id } })).toBe(0);
    expect(await prisma.personalNote.count({ where: { workspaceId: temp.id } })).toBe(0);
  });
});
