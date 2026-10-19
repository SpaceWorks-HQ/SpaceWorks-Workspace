import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { addColumn, createProject, deleteColumn, reorderColumns, setProjectArchived, updateProject } from "@/lib/projects/service";
import { listProjects } from "@/lib/projects/queries";
import type { TaskActor } from "@/lib/tasks/access";
import { getBoardData, getTaskDetail, listMyTasks } from "@/lib/tasks/queries";
import {
  addComment,
  addDependency,
  createTask,
  deleteComment,
  editComment,
  moveTask,
  removeDependency,
  setAssignees,
  setLabels,
  setTaskArchived,
  setTaskCompleted,
  updateTask,
} from "@/lib/tasks/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@tasks-${suffix}.test`;
const slugA = `tasks-a-${suffix}`;
const slugB = `tasks-b-${suffix}`;

let owner: TaskActor;
let admin: TaskActor;
let member: TaskActor;
let member2: TaskActor;
let guest: TaskActor;
let outsider: TaskActor;
let projectId: string;
let columns: Array<{ id: string; name: string; category: string }>;

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}

const notificationsOf = (userId: string, kind: string) => prisma.notification.findMany({ where: { userId, kind } });
const ok = <T>(result: { ok: boolean; data?: T; error?: string }) => {
  if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
  return result.data as T;
};

describe.sequential("tasks: projects, board and task flow", () => {
  beforeAll(async () => {
    const ownerUser = await createUser(`owner${domain}`, "Owner Olivia");
    const adminUser = await createUser(`admin${domain}`, "Admin Arun");
    const memberUser = await createUser(`member${domain}`, "Meera Nair");
    const member2User = await createUser(`member2${domain}`, "Joel Thomas");
    const guestUser = await createUser(`guest${domain}`, "Guest Gita");
    const outsiderUser = await createUser(`outsider${domain}`, "Outsider Omar");
    const wsA = await createWorkspace(slugA, ownerUser.id);
    const wsB = await createWorkspace(slugB, outsiderUser.id);
    await addMember(wsA.id, adminUser.id, "ADMIN");
    await addMember(wsA.id, memberUser.id, "MEMBER");
    await addMember(wsA.id, member2User.id, "MEMBER");
    await addMember(wsA.id, guestUser.id, "GUEST");
    owner = await actorFor(ownerUser.id, wsA.id, "OWNER");
    admin = await actorFor(adminUser.id, wsA.id, "ADMIN");
    member = await actorFor(memberUser.id, wsA.id, "MEMBER");
    member2 = await actorFor(member2User.id, wsA.id, "MEMBER");
    guest = await actorFor(guestUser.id, wsA.id, "GUEST");
    outsider = await actorFor(outsiderUser.id, wsB.id, "OWNER");
  });

  afterAll(async () => {
    await cleanup([slugA, slugB], domain);
  });

  it("lets a member start a project with a column template, and rejects a duplicate key", async () => {
    const created = ok(await createProject(member, { name: "Line-follower robot", key: "bot", template: "standard" }));
    expect(created.key).toBe("BOT");
    projectId = created.id;
    columns = await prisma.boardColumn.findMany({ where: { projectId }, orderBy: { position: "asc" } });
    expect(columns.map((c) => c.name)).toEqual(["To do", "In progress", "Review", "Done"]);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(project.ownerId).toBe(member.user.id);
    const duplicate = await createProject(member2, { name: "Another bot", key: "BOT" });
    expect(duplicate.ok).toBe(false);
    expect(await prisma.searchDocument.count({ where: { entityType: "project", entityId: projectId } })).toBe(1);
    expect((await listProjects(guest, "open")).map((p) => p.key)).toEqual(["BOT"]);
  });

  it("does not let guests create projects or tasks", async () => {
    expect((await createProject(guest, { name: "Guest project", key: "GST" })).ok).toBe(false);
    expect((await createTask(guest, { projectId, title: "Sneaky" })).ok).toBe(false);
  });

  it("creates tasks with per-workspace numbers, assigns and notifies", async () => {
    const first = ok(await createTask(member, { projectId, title: "Pick a motor driver", assigneeIds: [member2.user.id], priority: "HIGH", dueDate: "2026-10-25" }));
    const second = ok(await createTask(member, { projectId, title: "Design the sensor bar" }));
    const third = ok(await createTask(member, { projectId, title: "PID controller", atTop: true }));
    expect(second.number).toBe(first.number + 1);
    expect(first.reference).toBe(`BOT-${first.number}`);
    expect(first.url).toBe(`/w/${slugA}/projects/BOT/${first.number}`);
    const board = (await getBoardData(member, "BOT"))!;
    const todo = board.tasks.filter((t) => t.columnId === columns[0]!.id).sort((a, b) => a.position - b.position);
    expect(todo.map((t) => t.number)).toEqual([third.number, first.number, second.number]);
    const assigned = await notificationsOf(member2.user.id, "task.assigned");
    expect(assigned).toHaveLength(1);
    expect(assigned[0]!.url).toBe(first.url);
    expect(await prisma.searchDocument.count({ where: { entityType: "task", entityId: first.id } })).toBe(1);
    // Guests cannot be assigned.
    expect((await setAssignees(member, { taskId: first.id, userIds: [guest.user.id] })).ok).toBe(false);
  });

  it("moves cards between and within columns and completes in Done", async () => {
    const tasks = await prisma.task.findMany({ where: { projectId }, orderBy: { number: "asc" } });
    const [a, b, c] = tasks;
    // Move a below b inside To do.
    ok(await moveTask(member, { taskId: a!.id, columnId: columns[0]!.id, afterTaskId: b!.id }));
    let board = (await getBoardData(member, "BOT"))!;
    expect(board.tasks.filter((t) => t.columnId === columns[0]!.id).sort((x, y) => x.position - y.position).map((t) => t.id)).toEqual([c!.id, b!.id, a!.id]);
    // Move a to the top of Done.
    ok(await moveTask(member, { taskId: a!.id, columnId: columns[3]!.id, afterTaskId: null }));
    const done = await prisma.task.findUniqueOrThrow({ where: { id: a!.id } });
    expect(done.columnId).toBe(columns[3]!.id);
    expect(done.completedAt).not.toBeNull();
    expect(await prisma.taskActivity.count({ where: { taskId: a!.id, kind: "moved" } })).toBe(1);
    // The assignee hears about it.
    expect(await notificationsOf(member2.user.id, "task.status_changed")).toHaveLength(1);
    // Moving back out of Done reopens it.
    ok(await moveTask(member, { taskId: a!.id, columnId: columns[1]!.id, afterTaskId: null }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: a!.id } })).completedAt).toBeNull();
    // Guests can't move.
    expect((await moveTask(guest, { taskId: a!.id, columnId: columns[0]!.id, afterTaskId: null })).ok).toBe(false);
    board = (await getBoardData(guest, "BOT"))!;
    expect(board.permissions).toEqual({ canEdit: false, canComment: true, canManage: false });
  });

  it("lets guests read and comment but not edit; mentions dispatch", async () => {
    const task = await prisma.task.findFirstOrThrow({ where: { projectId, title: "Pick a motor driver" } });
    expect((await updateTask(guest, { taskId: task.id, title: "Hijacked" })).ok).toBe(false);
    expect((await setTaskCompleted(guest, { taskId: task.id, completed: true })).ok).toBe(false);
    expect((await setLabels(guest, { taskId: task.id, labelIds: [] })).ok).toBe(false);
    const detail = await getTaskDetail(guest, task.number);
    expect(detail?.title).toBe("Pick a motor driver");
    const comment = ok(await addComment(guest, { taskId: task.id, body: `Have you asked <@${member.user.id}>?` }));
    expect(await notificationsOf(member.user.id, "mention")).toHaveLength(1);
    // The assignee (not mentioned) gets "comment on your task"; the creator was mentioned instead.
    expect(await notificationsOf(member2.user.id, "task.commented")).toHaveLength(1);
    // Only the author edits; authors and admins delete.
    expect((await editComment(member, { commentId: comment.id, body: "edited by someone else" })).ok).toBe(false);
    ok(await editComment(guest, { commentId: comment.id, body: `Have you asked <@${member.user.id}> and <@${member2.user.id}>?` }));
    expect(await notificationsOf(member2.user.id, "mention")).toHaveLength(1);
    expect(await notificationsOf(member.user.id, "mention")).toHaveLength(1);
    ok(await deleteComment(admin, { commentId: comment.id }));
    expect((await prisma.taskComment.findUniqueOrThrow({ where: { id: comment.id } })).deletedAt).not.toBeNull();
  });

  it("isolates workspaces", async () => {
    const task = await prisma.task.findFirstOrThrow({ where: { projectId } });
    expect(await getBoardData(outsider, "BOT")).toBeNull();
    expect(await getTaskDetail(outsider, task.number)).toBeNull();
    expect((await updateTask(outsider, { taskId: task.id, title: "Cross-tenant" })).ok).toBe(false);
    expect((await moveTask(outsider, { taskId: task.id, columnId: columns[0]!.id, afterTaskId: null })).ok).toBe(false);
    expect((await addComment(outsider, { taskId: task.id, body: "hello" })).ok).toBe(false);
    expect((await createTask(outsider, { projectId, title: "Into their project" })).ok).toBe(false);
    expect((await updateProject(outsider, { projectId, name: "Mine now", key: "BOT", status: "ACTIVE" })).ok).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).title).not.toBe("Cross-tenant");
    // A reference from another workspace never resolves.
    const theirs = ok(await createProject(outsider, { name: "Their bot", key: "OTH" }));
    const theirTask = ok(await createTask(outsider, { projectId: theirs.id, title: "Their task" }));
    expect((await addDependency(member, { taskId: task.id, reference: `OTH-${theirTask.number}`, direction: "blockedBy" })).ok).toBe(false);
  });

  it("rejects dependency cycles and notifies when the last blocker closes", async () => {
    const x = ok(await createTask(member, { projectId, title: "Order parts", assigneeIds: [member.user.id] }));
    const y = ok(await createTask(member, { projectId, title: "Assemble", assigneeIds: [member2.user.id] }));
    const z = ok(await createTask(member, { projectId, title: "Test drive", assigneeIds: [member2.user.id] }));
    ok(await addDependency(member, { taskId: y.id, reference: x.reference, direction: "blockedBy" })); // x blocks y
    ok(await addDependency(member, { taskId: y.id, reference: z.reference, direction: "blocks" })); // y blocks z
    const circular = await addDependency(member, { taskId: x.id, reference: z.reference, direction: "blockedBy" }); // z blocks x → circular
    expect(circular.ok).toBe(false);
    expect((await addDependency(member, { taskId: x.id, reference: x.reference, direction: "blocks" })).ok).toBe(false);
    expect((await addDependency(member, { taskId: y.id, reference: x.reference, direction: "blockedBy" })).ok).toBe(false);
    expect((await getBoardData(member, "BOT"))!.tasks.find((t) => t.id === y.id)!.blocked).toBe(true);
    const before = (await notificationsOf(member2.user.id, "task.unblocked")).length;
    ok(await setTaskCompleted(member, { taskId: x.id, completed: true }));
    expect((await notificationsOf(member2.user.id, "task.unblocked")).length).toBe(before + 1);
    const xRow = await prisma.task.findUniqueOrThrow({ where: { id: x.id }, include: { column: true } });
    expect(xRow.column?.category).toBe("DONE");
    expect((await getBoardData(member, "BOT"))!.tasks.find((t) => t.id === y.id)!.blocked).toBe(false);
    ok(await removeDependency(member, { blockingTaskId: y.id, blockedTaskId: z.id }));
    expect(await prisma.taskDependency.count({ where: { blockedTaskId: z.id } })).toBe(0);
  });

  it("supports subtasks with progress", async () => {
    const parent = ok(await createTask(member, { projectId, title: "Build the chassis" }));
    const s1 = ok(await createTask(member, { parentId: parent.id, title: "Cut acrylic" }));
    ok(await createTask(member, { parentId: parent.id, title: "Drill holes" }));
    expect((await createTask(member, { parentId: s1.id, title: "Too deep" })).ok).toBe(false);
    ok(await setTaskCompleted(member, { taskId: s1.id, completed: true }));
    const card = (await getBoardData(member, "BOT"))!.tasks.find((t) => t.id === parent.id)!;
    expect([card.subtaskDone, card.subtaskCount]).toEqual([1, 2]);
    expect((await getBoardData(member, "BOT"))!.tasks.some((t) => t.id === s1.id)).toBe(false);
  });

  it("archives and restores tasks and keeps My tasks accurate", async () => {
    const mine = ok(await createTask(member, { projectId, title: "Mine", assigneeIds: [member.user.id] }));
    expect((await listMyTasks(member)).some((t) => t.id === mine.id)).toBe(true);
    ok(await setTaskArchived(member, { taskId: mine.id, archived: true }));
    expect((await listMyTasks(member)).some((t) => t.id === mine.id)).toBe(false);
    expect(await prisma.searchDocument.count({ where: { entityType: "task", entityId: mine.id } })).toBe(0);
    expect((await updateTask(member, { taskId: mine.id, title: "Edit archived" })).ok).toBe(false);
    ok(await setTaskArchived(member, { taskId: mine.id, archived: false }));
    expect((await listMyTasks(member)).some((t) => t.id === mine.id)).toBe(true);
  });

  it("limits column management to admins and the project owner", async () => {
    expect((await addColumn(member2, { projectId, name: "Blocked" })).ok).toBe(false);
    const added = ok(await addColumn(member, { projectId, name: "Parked", category: "TODO" }));
    ok(await addColumn(admin, { projectId, name: "Shipped", category: "DONE" }));
    const ids = (await prisma.boardColumn.findMany({ where: { projectId }, orderBy: { position: "asc" } })).map((c) => c.id);
    ok(await reorderColumns(member, { projectId, columnIds: [...ids].reverse() }));
    expect((await prisma.boardColumn.findMany({ where: { projectId }, orderBy: { position: "asc" } })).map((c) => c.id)).toEqual([...ids].reverse());
    const task = ok(await createTask(member, { projectId, columnId: added.id, title: "Parked idea" }));
    ok(await deleteColumn(member, { columnId: added.id, moveToColumnId: columns[0]!.id }));
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).columnId).toBe(columns[0]!.id);
    expect((await deleteColumn(guest, { columnId: columns[1]!.id, moveToColumnId: columns[0]!.id })).ok).toBe(false);
  });

  it("archives projects (read-only) and hides private-team projects", async () => {
    expect((await setProjectArchived(member2, { projectId }, true)).ok).toBe(false);
    ok(await setProjectArchived(member, { projectId }, true));
    expect((await createTask(member, { projectId, title: "After archive" })).ok).toBe(false);
    expect((await listProjects(member, "open")).some((p) => p.id === projectId)).toBe(false);
    ok(await setProjectArchived(admin, { projectId }, false));

    const team = await prisma.team.create({ data: { workspaceId: owner.workspace.id, name: "Core", slug: `core-${suffix}`, visibility: "PRIVATE", members: { create: [{ userId: member.user.id }] } } });
    const secret = ok(await createProject(member, { name: "Secret build", key: "SEC", teamId: team.id }));
    const secretTask = ok(await createTask(member, { projectId: secret.id, title: "Hidden task" }));
    expect(await getBoardData(member2, "SEC")).toBeNull();
    expect(await getTaskDetail(member2, secretTask.number)).toBeNull();
    expect((await listProjects(member2, "all")).some((p) => p.key === "SEC")).toBe(false);
    expect(await getBoardData(admin, "SEC")).not.toBeNull();
    expect((await createProject(member2, { name: "Sneak in", key: "SNK", teamId: team.id })).ok).toBe(false);
    expect((await setAssignees(member, { taskId: secretTask.id, userIds: [member2.user.id] })).ok).toBe(false);
  });
});
