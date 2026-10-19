import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createProject } from "@/lib/projects/service";
import type { TaskActor } from "@/lib/tasks/access";
import { generateRecurringTasks, setRecurrence, skipNextOccurrence, stopRecurrence } from "@/lib/tasks/recurrenceService";
import { sendDueReminders } from "@/lib/tasks/reminders";
import { createTask, setTaskCompleted } from "@/lib/tasks/service";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@tasks-rec-${suffix}.test`;
const slug = `tasks-rec-${suffix}`;

let member: TaskActor;
let joel: TaskActor;
let guest: TaskActor;
let projectId: string;

async function actorFor(userId: string, workspaceId: string, role: WorkspaceRole): Promise<TaskActor> {
  const [user, workspace] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId } }), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } })]);
  return { user: { id: user.id, name: user.name }, workspace, membership: { role } };
}

const ok = <T>(result: { ok: boolean; data?: T; error?: string }) => {
  if (!result.ok) throw new Error(`Expected ok, got: ${result.error}`);
  return result.data as T;
};

describe.sequential("tasks: recurrence and reminders", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`, "Owner");
    const meera = await createUser(`meera${domain}`, "Meera");
    const joelUser = await createUser(`joel${domain}`, "Joel");
    const guestUser = await createUser(`guest${domain}`, "Guest");
    const ws = await createWorkspace(slug, owner.id);
    await addMember(ws.id, meera.id, "MEMBER");
    await addMember(ws.id, joelUser.id, "MEMBER");
    await addMember(ws.id, guestUser.id, "GUEST");
    member = await actorFor(meera.id, ws.id, "MEMBER");
    joel = await actorFor(joelUser.id, ws.id, "MEMBER");
    guest = await actorFor(guestUser.id, ws.id, "GUEST");
    projectId = ok(await createProject(member, { name: "Space upkeep", key: "OPS" })).id;
  });

  afterAll(async () => {
    await cleanup([slug], domain);
  });

  it("creates each weekly instance exactly once, even with concurrent workers, and rotates assignees", async () => {
    const template = ok(await createTask(member, { projectId, title: "Clean the workbench", priority: "MEDIUM" }));
    expect((await setRecurrence(guest, { taskId: template.id, rrule: "FREQ=WEEKLY;BYDAY=MO" })).ok).toBe(false);
    expect((await setRecurrence(member, { taskId: template.id, rrule: "FREQ=HOURLY" })).ok).toBe(false);
    const set = ok(
      await setRecurrence(member, {
        taskId: template.id,
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        createMode: "ON_SCHEDULE",
        assigneeMode: "ROTATE",
        assigneeIds: [member.user.id, joel.user.id],
        dueOffsetDays: 2,
        startDate: "2030-01-07",
      }),
    );
    expect(set.description).toBe("Every week on Mon");
    expect(set.nextRunAt).toBe(new Date("2030-01-07T09:00:00+05:30").toISOString());
    const rule = await prisma.taskRecurrence.findFirstOrThrow({ where: { templateTaskId: template.id } });

    // Not yet due.
    expect(await generateRecurringTasks(new Date("2030-01-07T08:00:00+05:30"))).toBe(0);

    // Two replicas tick at the same moment.
    const tick = new Date("2030-01-07T09:00:30+05:30");
    const results = await Promise.all([generateRecurringTasks(tick), generateRecurringTasks(tick), generateRecurringTasks(tick)]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(1);
    let instances = await prisma.task.findMany({ where: { recurrenceId: rule.id }, orderBy: { number: "asc" }, include: { assignees: true } });
    expect(instances).toHaveLength(1);
    expect(instances[0]!.title).toBe("Clean the workbench");
    expect(instances[0]!.priority).toBe("MEDIUM");
    expect(instances[0]!.dueAt?.toISOString()).toBe(new Date("2030-01-09T00:00:00+05:30").toISOString());
    expect(instances[0]!.assignees.map((a) => a.userId)).toEqual([member.user.id]);
    expect(await prisma.taskOccurrence.count({ where: { recurrenceId: rule.id } })).toBe(1);
    const advanced = await prisma.taskRecurrence.findUniqueOrThrow({ where: { id: rule.id } });
    expect(advanced.nextRunAt?.toISOString()).toBe(new Date("2030-01-14T09:00:00+05:30").toISOString());
    expect(advanced.lastCreatedTaskId).toBe(instances[0]!.id);
    expect(await prisma.notification.count({ where: { userId: member.user.id, kind: "task.assigned" } })).toBe(1);

    // Running again in the same week does nothing; the next week rotates to Joel.
    expect(await generateRecurringTasks(new Date("2030-01-10T10:00:00+05:30"))).toBe(0);
    expect(await generateRecurringTasks(new Date("2030-01-14T09:01:00+05:30"))).toBe(1);
    instances = await prisma.task.findMany({ where: { recurrenceId: rule.id }, orderBy: { number: "asc" }, include: { assignees: true } });
    expect(instances.map((t) => t.assignees.map((a) => a.userId))).toEqual([[member.user.id], [joel.user.id]]);

    // Skip the next one, then stop.
    const skipped = ok(await skipNextOccurrence(member, { taskId: template.id }));
    expect(skipped.nextRunAt).toBe(new Date("2030-01-28T09:00:00+05:30").toISOString());
    ok(await stopRecurrence(member, { taskId: template.id }));
    expect(await generateRecurringTasks(new Date("2030-02-28T09:00:00+05:30"))).toBe(0);
  });

  it("catches up with one instance after downtime instead of flooding", async () => {
    const template = ok(await createTask(member, { projectId, title: "Water the plants" }));
    ok(await setRecurrence(member, { taskId: template.id, rrule: "FREQ=DAILY", startDate: "2031-03-01" }));
    const rule = await prisma.taskRecurrence.findFirstOrThrow({ where: { templateTaskId: template.id } });
    expect(await generateRecurringTasks(new Date("2031-03-20T12:00:00+05:30"))).toBe(1);
    expect(await generateRecurringTasks(new Date("2031-03-20T12:00:00+05:30"))).toBe(0);
    const after = await prisma.taskRecurrence.findUniqueOrThrow({ where: { id: rule.id } });
    expect(after.nextRunAt?.toISOString()).toBe(new Date("2031-03-21T09:00:00+05:30").toISOString());
  });

  it("creates the next instance only after the current one is done (on completion)", async () => {
    const template = ok(await createTask(member, { projectId, title: "Restock solder", assigneeIds: [joel.user.id] }));
    ok(await setRecurrence(member, { taskId: template.id, rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=FR", createMode: "ON_COMPLETION", assigneeIds: [joel.user.id] }));
    const rule = await prisma.taskRecurrence.findFirstOrThrow({ where: { templateTaskId: template.id } });
    expect(rule.nextRunAt).toBeNull();
    expect(await generateRecurringTasks(new Date())).toBe(0);
    ok(await setTaskCompleted(joel, { taskId: template.id, completed: true }));
    expect((await prisma.taskRecurrence.findUniqueOrThrow({ where: { id: rule.id } })).nextRunAt).not.toBeNull();
    expect(await generateRecurringTasks(new Date(Date.now() + 1000))).toBe(1);
    expect(await generateRecurringTasks(new Date(Date.now() + 2000))).toBe(0);
    const next = await prisma.task.findFirstOrThrow({ where: { recurrenceId: rule.id } });
    expect(next.completedAt).toBeNull();
    expect(next.dueAt).not.toBeNull();
    // Completing the new instance queues the one after it.
    ok(await setTaskCompleted(joel, { taskId: next.id, completed: true }));
    expect(await generateRecurringTasks(new Date(Date.now() + 3000))).toBe(1);
    expect(await prisma.task.count({ where: { recurrenceId: rule.id } })).toBe(2);
  });

  it("sends due and overdue reminders once per due date", async () => {
    const task = ok(await createTask(member, { projectId, title: "Pay the rent", assigneeIds: [joel.user.id], dueDate: "2032-05-10" }));
    const count = (kind: string) => prisma.notification.count({ where: { userId: joel.user.id, kind, url: { contains: `/${task.number}` } } });
    await sendDueReminders(new Date("2032-05-10T08:00:00+05:30"));
    expect(await count("task.due")).toBe(0);
    const morning = new Date("2032-05-10T09:05:00+05:30");
    await Promise.all([sendDueReminders(morning), sendDueReminders(morning)]);
    await sendDueReminders(new Date("2032-05-10T15:00:00+05:30"));
    expect(await count("task.due")).toBe(1);
    await sendDueReminders(new Date("2032-05-11T09:30:00+05:30"));
    await sendDueReminders(new Date("2032-05-12T09:30:00+05:30"));
    expect(await count("task.overdue")).toBe(1);
    ok(await setTaskCompleted(joel, { taskId: task.id, completed: true }));
    await sendDueReminders(new Date("2032-05-13T09:30:00+05:30"));
    expect(await count("task.overdue")).toBe(1);
  });
});
