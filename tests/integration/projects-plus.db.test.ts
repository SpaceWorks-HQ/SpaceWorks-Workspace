import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { WorkspaceRole } from "@prisma/client";
import type { TaskActor } from "@/lib/tasks/access";
import { createProject, updateProject, setProjectArchived } from "@/lib/projects/service";
import { createTask, setTaskCompleted, setTaskArchived, updateTask, addDependency } from "@/lib/tasks/service";
import { saveMilestone, removeMilestone, postStatusUpdate, saveTaskPlan } from "@/lib/projects/plusService";
import { getProjectPlan, projectUpdates, listProjectBlockers, projectReportCsv } from "@/lib/projects/plusQueries";
import { nextUpdateDue } from "@/lib/projects/plusLogic";
import { sendProjectUpdateReminders } from "@/lib/scheduled/projectsPlus";
import { searchDocuments } from "@/lib/search/query";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";
const suffix = uniqueSuffix(), domain = `@planning-${suffix}.test`;
const slugs = [`plan-a-${suffix}`, `plan-b-${suffix}`];
let lead: TaskActor, member: TaskActor, guest: TaskActor, admin: TaskActor, outside: TaskActor;
let projectId: string, otherProjectId: string, taskId: string, taskNumber: number, milestoneId: string;
function data<T>(r: { ok: boolean; data?: T; error?: string }): T { if (!r.ok || !r.data) throw new Error(r.error ?? "Missing result"); return r.data; }
const milestone = (extra = {}) => ({ projectId, name: "Office ready", targetOn: "2026-11-01", status: "PENDING", taskIds: [taskId], ...extra });
const update = () => ({ projectId, status: "AT_RISK", note: "Waiting for the committee decision.", blockers: ["Decision pending"], nextSteps: ["Follow up on Friday"] });
const planInput = (extra = {}) => ({ taskId, startsOn: "2026-10-01", blockerReason: "Awaiting decision", blockerOwnerId: lead.user.id, ...extra });
const searchActor = (a: TaskActor) => ({ workspaceId: a.workspace.id, userId: a.user.id, role: a.membership.role });

describe.sequential("projects plus tenant and planning flows", () => {
  beforeAll(async () => {
    const users = await Promise.all(["lead", "member", "guest", "admin", "outside"].map(n => createUser(`${n}${domain}`, n)));
    const a = await createWorkspace(slugs[0], users[0].id), b = await createWorkspace(slugs[1], users[4].id);
    for (const [i, role] of [[1, "MEMBER"], [2, "GUEST"], [3, "ADMIN"]] as const) await addMember(a.id, users[i].id, role);
    const actors = users.map((user, i) => ({ user, workspace: i === 4 ? b : a, membership: { role: (["OWNER", "MEMBER", "GUEST", "ADMIN", "OWNER"] as WorkspaceRole[])[i] } }));
    [lead, member, guest, admin, outside] = actors;
    projectId = data(await createProject(lead, { name: "Office readiness", key: "OFC", ownerId: member.user.id })).id;
    // Use a member lead so role and ownership are tested independently.
    await prisma.project.update({ where: { id: projectId }, data: { ownerId: member.user.id } });
    otherProjectId = data(await createProject(outside, { name: "Other office", key: "OTH" })).id;
    const t = data(await createTask(member, { projectId, title: "Confirm handover", dueDate: "2026-10-25" })); taskId = t.id; taskNumber = t.number;
  });
  afterAll(async () => { await cleanup(slugs, domain); });
  it("allows leads and admins to plan and guests to read", async () => {
    milestoneId = data(await saveMilestone(member, milestone())).id;
    expect((await saveMilestone(admin, milestone({ id: milestoneId, notes: "Confirm the key register." }))).ok).toBe(true);
    expect((await getProjectPlan(guest, "OFC"))?.milestones).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { workspaceId: lead.workspace.id, targetId: milestoneId } })).toBe(2);
  });
  it("rejects guests, non-leads and cross-workspace writes", async () => {
    const nonLead = { ...member, user: admin.user }; // Current DB role wins over the supplied role.
    expect((await saveMilestone(nonLead, milestone({ id: milestoneId }))).ok).toBe(true);
    const user = await createUser(`nonlead${domain}`); await addMember(lead.workspace.id, user.id);
    const actor = { ...member, user };
    expect((await saveMilestone(actor, milestone())).ok).toBe(false);
    for (const a of [guest, outside]) {
      expect((await saveMilestone(a, milestone({ id: milestoneId }))).ok).toBe(false);
      expect((await removeMilestone(a, { projectId, id: milestoneId })).ok).toBe(false);
      expect((await postStatusUpdate(a, update())).ok).toBe(false);
      expect((await saveTaskPlan(a, planInput())).ok).toBe(false);
    }
    expect(await getProjectPlan(outside, "OFC")).toBeNull();
  });
  it("requires links to belong to the same project and tenant", async () => {
    const t = data(await createTask(outside, { projectId: otherProjectId, title: "Foreign task" }));
    expect((await saveMilestone(member, milestone({ taskIds: [t.id] }))).ok).toBe(false);
    const p = data(await createProject(member, { name: "Another project", key: "NEW" }));
    const local = data(await createTask(member, { projectId: p.id, title: "Another task" }));
    expect((await saveMilestone(member, milestone({ taskIds: [local.id] }))).ok).toBe(false);
    await expect(prisma.projectMilestoneTask.create({ data: { workspaceId: lead.workspace.id, projectId, milestoneId, taskId: t.id } })).rejects.toMatchObject({ code: "P2003" });
  });
  it("derives done and reopening from linked tasks, with manual override", async () => {
    await setTaskCompleted(member, { taskId, completed: true });
    expect((await getProjectPlan(member, "OFC"))?.milestones[0].status).toBe("DONE");
    await setTaskCompleted(member, { taskId, completed: false });
    expect((await getProjectPlan(member, "OFC"))?.milestones[0].status).toBe("PENDING");
    await saveMilestone(member, milestone({ id: milestoneId, status: "DONE" }));
    expect((await getProjectPlan(member, "OFC"))?.milestones[0].status).toBe("DONE");
    await saveMilestone(member, milestone({ id: milestoneId }));
  });
  it("retains archived linked tasks without declaring them complete", async () => {
    await setTaskArchived(member, { taskId, archived: true });
    expect((await saveMilestone(member, milestone({ id: milestoneId }))).ok).toBe(true);
    const m = (await getProjectPlan(member, "OFC"))!.milestones[0];
    expect(m.tasks[0].archived).toBe(true); expect(m.status).toBe("PENDING");
    expect((await saveMilestone(member, milestone())).ok).toBe(false);
    await setTaskArchived(member, { taskId, archived: false });
  });
  it("saves task starts and blockers, validates dates and follow-up owners", async () => {
    expect((await saveTaskPlan(member, planInput())).ok).toBe(true);
    expect((await saveTaskPlan(member, planInput({ startsOn: "2026-11-01" }))).ok).toBe(false);
    expect((await updateTask(member, { taskId, dueDate: "2026-09-30" })).ok).toBe(false);
    expect((await saveTaskPlan(member, planInput({ blockerOwnerId: outside.user.id }))).ok).toBe(false);
    expect((await saveTaskPlan(member, planInput({ blockerOwnerId: guest.user.id }))).ok).toBe(false);
    expect((await listProjectBlockers(member)).map(t => t.id)).toContain(taskId);
    expect(await listProjectBlockers(outside)).toEqual([]);
    expect((await getProjectPlan(member, "OFC"))!.tasks.find(t => t.id === taskId)?.start).toBe("2026-10-01");
  });
  it("clears a manual blocker and follows dependency completion", async () => {
    await saveTaskPlan(member, planInput({ blockerReason: "" }));
    expect((await listProjectBlockers(member)).some(t => t.id === taskId)).toBe(false);
    const before = data(await createTask(member, { projectId, title: "Make a decision" }));
    await addDependency(member, { taskId, reference: before.reference, direction: "blockedBy" });
    expect((await listProjectBlockers(member)).find(t => t.id === taskId)?.blockedBy[0].title).toBe("Make a decision");
    await setTaskCompleted(member, { taskId: before.id, completed: true });
    expect((await listProjectBlockers(member)).some(t => t.id === taskId)).toBe(false);
  });
  it("keeps a manual blocker without a false ready-to-go notification when dependencies finish", async () => {
    const prerequisite = data(await createTask(member, { projectId, title: "Prepare the key register" }));
    const blocked = data(await createTask(member, { projectId, title: "Approve the key register", assigneeIds: [lead.user.id] }));
    expect((await saveTaskPlan(member, { taskId: blocked.id, startsOn: null, blockerReason: "Awaiting committee sign-off", blockerOwnerId: lead.user.id })).ok).toBe(true);
    await addDependency(member, { taskId: blocked.id, reference: prerequisite.reference, direction: "blockedBy" });
    const events = () => prisma.notificationEventRecord.count({ where: { workspaceId: member.workspace.id, type: "task.unblocked", payload: { path: ["data", "taskId"], equals: blocked.id } } });
    const before = await events();
    expect((await setTaskCompleted(member, { taskId: prerequisite.id, completed: true })).ok).toBe(true);
    const row = (await listProjectBlockers(member)).find(t => t.id === blocked.id);
    expect(row?.blockerReason).toBe("Awaiting committee sign-off");
    expect(row?.blockedBy).toEqual([]);
    expect(await events()).toBe(before);
    expect(await prisma.taskActivity.count({ where: { taskId: blocked.id, kind: "unblocked" } })).toBe(0);
  });
  it("protects private projects and redacts hidden dependency details", async () => {
    const team = await prisma.team.create({ data: { workspaceId: lead.workspace.id, name: "Private crew", slug: `private-${suffix}`, visibility: "PRIVATE", members: { create: { userId: member.user.id } } } });
    const p = data(await createProject(member, { name: "Private readiness", key: "SEC", teamId: team.id }));
    const t = data(await createTask(member, { projectId: p.id, title: "Confidential task" }));
    await saveMilestone(member, milestone({ projectId: p.id, taskIds: [t.id], name: "PrivateMilestone" }));
    await addDependency(member, { taskId, reference: t.reference, direction: "blockedBy" });
    const publicUser = await createUser(`public${domain}`); await addMember(lead.workspace.id, publicUser.id);
    const a = { ...member, user: publicUser };
    expect(await getProjectPlan(a, "SEC")).toBeNull();
    expect((await saveTaskPlan(a, { taskId: t.id, startsOn: null, blockerReason: "", blockerOwnerId: null })).ok).toBe(false);
    const row = (await listProjectBlockers(a)).find(r => r.id === taskId)!;
    expect(row.restrictedBlocker).toBe(true); expect(row.blockedBy).toEqual([]);
    expect(JSON.stringify(row)).not.toContain("Confidential");
    expect(await searchDocuments(searchActor(a), "PrivateMilestone")).toEqual([]);
    expect((await searchDocuments(searchActor(admin), "PrivateMilestone")).length).toBeGreaterThan(0);
    await setTaskCompleted(member, { taskId: t.id, completed: true });
  });
  it("stores weekly health history and exports recent notes and overdue tasks", async () => {
    await saveMilestone(member, milestone({ id: milestoneId, notes: "Confirm the keys." }));
    const result = data(await postStatusUpdate(member, update()));
    const plan = (await getProjectPlan(guest, "OFC", new Date("2026-11-01T00:00Z")))!;
    expect(plan.updates[0].id).toBe(result.id); expect(plan.updates[0].status).toBe("AT_RISK");
    const csv = projectReportCsv(plan);
    expect(csv).toContain('"Overdue task"'); expect(csv).toContain('"Decision pending"'); expect(csv).toContain('"Follow up on Friday"');
    expect(csv.split("\r\n")[0]).toContain('"Notes"');
    expect(csv.split("\r\n").find(line => line.startsWith('"Milestone"'))).toMatch(/,"Confirm the keys\."$/);
    expect(plan.progress.percent).toBe(50);
    expect((await searchDocuments(searchActor(guest), "committee", "project_update")).map(r => r.entityId)).toContain(result.id);
    expect(await projectUpdates(outside, projectId)).toEqual([]);
  });
  it("paginates update history in stable newest-first order", async () => {
    for (let i = 0; i < 21; i++) await postStatusUpdate(member, { ...update(), note: `Check-in ${i}` });
    const first = await projectUpdates(member, projectId), second = await projectUpdates(member, projectId, 1);
    expect(first).toHaveLength(20); expect(second).toHaveLength(2);
    expect(new Set([...first, ...second].map(u => u.id)).size).toBe(22);
  });
  it("claims reminders once per due update and only for the active visible lead", async () => {
    const latest = (await projectUpdates(member, projectId))[0];
    const due = nextUpdateDue(new Date(latest.createdAt), member.workspace.timezone);
    const count = () => prisma.notificationEventRecord.count({ where: { workspaceId: member.workspace.id, type: "project.update_due", payload: { path: ["data", "projectId"], equals: projectId } } });
    await Promise.all([sendProjectUpdateReminders(due), sendProjectUpdateReminders(due)]);
    expect(await count()).toBe(1);
    await sendProjectUpdateReminders(new Date(due.getTime() + 60000)); expect(await count()).toBe(1);
    await postStatusUpdate(member, update());
    await prisma.membership.update({ where: { userId_workspaceId: { userId: member.user.id, workspaceId: member.workspace.id } }, data: { status: "SUSPENDED" } });
    await sendProjectUpdateReminders(new Date(due.getTime() + 86400000)); expect(await count()).toBe(1);
    expect(await getProjectPlan(member, "OFC")).toBeNull();
    expect((await saveMilestone(member, milestone())).ok).toBe(false);
    await prisma.membership.update({ where: { userId_workspaceId: { userId: member.user.id, workspaceId: member.workspace.id } }, data: { status: "ACTIVE" } });
  });
  it("refreshes search URLs after a key change and hides archived plans from search", async () => {
    await saveTaskPlan(member, planInput({ blockerReason: "Awaiting keyholder handover" }));
    const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    expect((await updateProject(member, { projectId, name: p.name, key: "OFF", status: "ACTIVE", ownerId: member.user.id, teamId: null })).ok).toBe(true);
    expect((await searchDocuments(searchActor(guest), "Office ready", "project_milestone"))[0].url).toContain("/OFF/");
    expect((await searchDocuments(searchActor(guest), "keyholder", "task"))[0].url).toContain("/OFF/");
    await setProjectArchived(member, { projectId }, true);
    expect((await saveMilestone(member, milestone())).ok).toBe(false);
    expect((await postStatusUpdate(member, update())).ok).toBe(false);
    expect((await saveTaskPlan(member, planInput())).ok).toBe(false);
    expect((await getProjectPlan(member, "OFF"))?.canManage).toBe(false);
    expect(await searchDocuments(searchActor(guest), "Office ready", "project_milestone")).toEqual([]);
    await setProjectArchived(member, { projectId }, false);
  });
  it("removes milestone links and the search entry together", async () => {
    expect((await removeMilestone(member, { projectId, id: milestoneId })).ok).toBe(true);
    expect(await prisma.projectMilestoneTask.count({ where: { workspaceId: member.workspace.id, milestoneId } })).toBe(0);
    expect(await prisma.searchDocument.count({ where: { workspaceId: member.workspace.id, entityId: milestoneId } })).toBe(0);
    expect((await getProjectPlan(member, "OFF"))!.tasks.some(t => t.id === taskId)).toBe(true);
    expect((await prisma.task.findFirstOrThrow({ where: { workspaceId: member.workspace.id, id: taskId } })).number).toBe(taskNumber);
  });
});
