import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { guard, OperationsError, parse, type OpsActor } from "@/lib/opsGaps/context";
import { canActOnMember, canManageOrgPeople, canRecordAttendance } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument } from "@/lib/search/documents";
import { departmentSchema, reportingSchema, responsibilitySchema, escalationSchema, attendanceSchema, wouldCycle, monthDays, stepSchema, responsibilityRoles, type AttendanceStatus } from "./rules";
import { dayRange } from "@/lib/people/availability";
import { timeOffSchema } from "@/lib/people/timeOff";
import { dayKey } from "@/lib/community/schedule";
export type { OpsActor as OrgActor };
export const unavailable = () => new OperationsError("That record is unavailable. Refresh and try again.");
export async function audit(actor: OpsActor, kind: string, id: string, tx: DbClient) {
  await recordAuditEvent({ workspaceId: actor.workspace.id, actorId: actor.user.id, action: `org_people.${kind}.saved`, targetType: kind, targetId: id, client: tx });
}
async function register(actor: OpsActor, kind: string, id: string, title: string, tx: DbClient, ownerId?: string) {
  const path = { department: "organisation", responsibility: "responsibilities", escalation: "escalation", attendance: "attendance" }[kind];
  await audit(actor, kind, id, tx);
  await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: `org_${kind}`, entityId: id, title, url: `/w/${actor.workspace.slug}/${path}#${id}`, visibility: ownerId ? "PRIVATE" : "WORKSPACE", ownerId }, tx);
  // Attendance contains personal information and stays out of the shared feed.
  if (!ownerId) await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, entityType: `org_${kind}`, entityId: id, verb: "updated", summary: `Updated an organisation ${kind}` }, tx);
}
export async function orgWrite<T>(actor: OpsActor, admin: boolean, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`org_people:${actor.workspace.id}`}))`;
    await guard(actor, admin, tx); return work(tx);
  }, { timeout: 15000 });
}
export async function requirePeople(actor: OpsActor, ids: Array<string | null>, tx: DbClient) {
  const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  if (await tx.membership.count({ where: { workspaceId: actor.workspace.id, userId: { in: unique }, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } } }) !== unique.length) throw new OperationsError("Choose active members in this workspace.");
}
export async function orgData(actor: OpsActor) {
  await guard(actor);
  const [departments, memberships, profiles] = await Promise.all([
    prisma.department.findMany({ where: { workspaceId: actor.workspace.id }, orderBy: { name: "asc" } }),
    prisma.membership.findMany({ where: { workspaceId: actor.workspace.id, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } }, select: { userId: true, role: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
    prisma.memberProfile.findMany({ where: { workspaceId: actor.workspace.id }, select: { userId: true, departmentId: true, managerId: true, engagementType: true } }),
  ]);
  return { departments, people: memberships.map(m => ({ id: m.userId, name: m.user.name || "Member", role: m.role, departmentId: profiles.find(p => p.userId === m.userId)?.departmentId ?? null, managerId: profiles.find(p => p.userId === m.userId)?.managerId ?? null, engagementType: profiles.find(p => p.userId === m.userId)?.engagementType ?? "VOLUNTEER" })) };
}
export async function saveDepartment(actor: OpsActor, input: unknown) {
  const v = parse(departmentSchema, input);
  return orgWrite(actor, true, async tx => {
    const rows = await tx.department.findMany({ where: { workspaceId: actor.workspace.id }, select: { id: true, parentId: true, name: true } });
    if (v.id && !rows.some(r => r.id === v.id) || v.parentId && !rows.some(r => r.id === v.parentId)) throw unavailable();
    if (wouldCycle(rows, v.id ?? "new", v.parentId)) throw new OperationsError("Choose a parent outside this department’s descendants.");
    if (rows.some(r => r.id !== v.id && r.name.toLowerCase() === v.name.toLowerCase())) throw new OperationsError("A department already uses this name. Choose another name.");
    await requirePeople(actor, [v.headId], tx);
    const { id, ...data } = v;
    const row = id ? await tx.department.update({ where: { id, workspaceId: actor.workspace.id }, data }) : await tx.department.create({ data: { ...data, workspaceId: actor.workspace.id } });
    await register(actor, "department", row.id, row.name, tx); return row.id;
  });
}
export async function saveReporting(actor: OpsActor, input: unknown) {
  const v = parse(reportingSchema, input);
  return orgWrite(actor, true, async tx => {
    await requirePeople(actor, [v.userId, v.managerId], tx);
    const target = await tx.membership.findFirstOrThrow({ where: { workspaceId: actor.workspace.id, userId: v.userId } });
    if (!canActOnMember(actor.membership, target.role)) throw unavailable();
    if (v.departmentId && !await tx.department.findFirst({ where: { workspaceId: actor.workspace.id, id: v.departmentId } })) throw unavailable();
    const profiles = await tx.memberProfile.findMany({ where: { workspaceId: actor.workspace.id }, select: { userId: true, managerId: true } });
    if (wouldCycle(profiles.map(p => ({ id: p.userId, parentId: p.managerId })), v.userId, v.managerId)) throw new OperationsError("Choose a manager outside this person’s reporting line.");
    const { userId, ...data } = v;
    await tx.memberProfile.upsert({ where: { workspaceId_userId: { workspaceId: actor.workspace.id, userId } }, create: { workspaceId: actor.workspace.id, userId, ...data }, update: data });
    await audit(actor, "reporting", userId, tx); return userId;
  });
}
export async function saveResponsibility(actor: OpsActor, input: unknown) {
  const v = parse(responsibilitySchema, input);
  return orgWrite(actor, true, async tx => {
    if (v.id && !await tx.responsibility.findFirst({ where: { workspaceId: actor.workspace.id, id: v.id } })) throw unavailable();
    await requirePeople(actor, [...v.responsibleIds, v.accountableId, ...v.consultedIds, ...v.informedIds, v.backupId], tx);
    const { id, reviewOn, ...data } = v;
    const payload = { ...data, reviewOn: new Date(reviewOn) };
    const row = id ? await tx.responsibility.update({ where: { workspaceId: actor.workspace.id, id }, data: payload }) : await tx.responsibility.create({ data: { ...payload, workspaceId: actor.workspace.id, createdById: actor.user.id } });
    await register(actor, "responsibility", row.id, row.title, tx); return row.id;
  });
}
export async function responsibilities(actor: OpsActor, filters: { q?: string; status?: string; userId?: string } = {}) {
  await guard(actor);
  return prisma.responsibility.findMany({ where: { workspaceId: actor.workspace.id, ...(filters.status ? { status: filters.status } : { status: { not: "ARCHIVED" } }), ...(filters.q ? { title: { contains: filters.q.slice(0, 160), mode: "insensitive" } } : {}), ...(filters.userId ? { OR: [{ responsibleIds: { has: filters.userId } }, { accountableId: filters.userId }, { consultedIds: { has: filters.userId } }, { informedIds: { has: filters.userId } }, { backupId: filters.userId }] } : {}) }, orderBy: [{ reviewOn: "asc" }, { id: "asc" }] });
}
export async function saveEscalation(actor: OpsActor, input: unknown) {
  const v = parse(escalationSchema, input);
  return orgWrite(actor, true, async tx => {
    if (v.id && !await tx.orgEscalationPath.findFirst({ where: { workspaceId: actor.workspace.id, id: v.id } })) throw unavailable();
    await requirePeople(actor, v.steps.map(s => s.userId), tx);
    const { id, ...data } = v;
    const row = id ? await tx.orgEscalationPath.update({ where: { id, workspaceId: actor.workspace.id }, data }) : await tx.orgEscalationPath.create({ data: { ...data, workspaceId: actor.workspace.id } });
    await register(actor, "escalation", row.id, row.title, tx); return row.id;
  });
}
export async function escalationData(actor: OpsActor) {
  const data = await orgData(actor);
  const [paths, profiles] = await Promise.all([
    prisma.orgEscalationPath.findMany({ where: { workspaceId: actor.workspace.id, ...(canManageOrgPeople(actor.membership) ? {} : { active: true }) }, orderBy: { title: "asc" } }),
    prisma.memberProfile.findMany({ where: { workspaceId: actor.workspace.id, userId: { in: data.people.map(p => p.id) }, ...(canManageOrgPeople(actor.membership) ? {} : { OR: [{ contactVisibility: "WORKSPACE" }, { userId: actor.user.id }] }) }, select: { userId: true, contactPhone: true, contactHandle: true } }),
  ]);
  return { ...data, paths: paths.map(p => ({ ...p, steps: parse(stepSchema.array(), p.steps) })), contacts: profiles };
}
export async function attendancePeople(actor: OpsActor, tx: DbClient = prisma) {
  await guard(actor, false, tx);
  const managed = await tx.memberProfile.findMany({ where: { workspaceId: actor.workspace.id, managerId: actor.user.id }, select: { userId: true } });
  const all = canManageOrgPeople(actor.membership);
  return tx.membership.findMany({ where: { workspaceId: actor.workspace.id, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null }, ...(all ? {} : { userId: { in: [actor.user.id, ...managed.map(p => p.userId)] } }) }, select: { userId: true, role: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } });
}
/** Approved requests only; availability alone may be travel/busy or manually entered away time. Never return leave notes. */
export async function approvedLeaveDays(actor: OpsActor, userIds: string[], days: string[], tx: DbClient = prisma) {
  const results = new Set<string>(); if (!days.length || !userIds.length) return results;
  const runs = await tx.checklistRun.findMany({ where: { workspaceId: actor.workspace.id, status: "DONE", subjectUserId: { in: userIds }, items: { some: { sourceType: "availability_request" } } }, select: { subjectUserId: true, items: { where: { sourceType: "availability_request" }, select: { descriptionMd: true } } } });
  for (const run of runs) { try {
    const payload = JSON.parse(run.items[0]?.descriptionMd ?? "{}"); const parsed = timeOffSchema.safeParse(payload);
    if (!parsed.success || parsed.data.type !== "AWAY") continue;
    // Cancellation removes availability; legacy approved requests are matched by their exact interval.
    const range = dayRange(parsed.data.from, parsed.data.to, actor.workspace.timezone);
    const exists = await tx.availability.findFirst({ where: { workspaceId: actor.workspace.id, userId: run.subjectUserId!, type: "AWAY", ...(payload.availabilityId ? { id: String(payload.availabilityId) } : range) }, select: { id: true } });
    if (exists) for (const d of days) if (d >= parsed.data.from && d <= parsed.data.to) results.add(`${run.subjectUserId}:${d}`);
  } catch { /* Ignore malformed legacy request payloads. */ } }
  return results;
}
export async function attendanceData(actor: OpsActor, month: string, filters: { userId?: string; teamId?: string } = {}) {
  const days = monthDays(month); if (!days.length) throw new OperationsError("Choose a month between 2000 and 2199.");
  let people = await attendancePeople(actor);
  const teams = await prisma.team.findMany({ where: { workspaceId: actor.workspace.id, archivedAt: null, ...(canManageOrgPeople(actor.membership) ? {} : { OR: [{ visibility: "PUBLIC" }, { members: { some: { userId: actor.user.id } } }] }) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  if (filters.teamId) {
    if (!teams.some(t => t.id === filters.teamId)) throw unavailable();
    const members = await prisma.teamMember.findMany({ where: { teamId: filters.teamId, team: { workspaceId: actor.workspace.id } }, select: { userId: true } });
    people = people.filter(p => members.some(m => m.userId === p.userId));
  }
  if (filters.userId) { if (!people.some(p => p.userId === filters.userId)) throw unavailable(); people = people.filter(p => p.userId === filters.userId); }
  const ids = people.map(p => p.userId);
  const [entries, leave, profiles] = await Promise.all([
    prisma.attendanceEntry.findMany({ where: { workspaceId: actor.workspace.id, userId: { in: ids }, dateOn: { gte: new Date(days[0]), lte: new Date(days.at(-1)!) } }, orderBy: [{ dateOn: "asc" }, { userId: "asc" }] }),
    approvedLeaveDays(actor, ids, days),
    prisma.memberProfile.findMany({ where: { workspaceId: actor.workspace.id, userId: { in: ids } }, select: { userId: true, engagementType: true } }),
  ]);
  const cells = people.flatMap(p => days.map(date => {
    const entry = entries.find(e => e.userId === p.userId && e.dateOn.toISOString().slice(0, 10) === date);
    const onLeave = leave.has(`${p.userId}:${date}`);
    return { userId: p.userId, name: p.user.name || "Member", engagementType: profiles.find(v => v.userId === p.userId)?.engagementType ?? "VOLUNTEER", date, status: onLeave ? "ON_LEAVE" as AttendanceStatus : entry?.status as AttendanceStatus | undefined, source: onLeave ? "Approved leave" : entry ? "Manual" : "Not recorded", entry: entry ?? null };
  }));
  return { people, teams, days, cells };
}
export async function saveAttendance(actor: OpsActor, input: unknown) {
  const v = parse(attendanceSchema, input);
  if (v.dateOn > dayKey(new Date(), actor.workspace.timezone)) throw new OperationsError("Record attendance for today or a past date.");
  return orgWrite(actor, false, async tx => {
    const target = await tx.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId: v.userId, status: "ACTIVE", role: { not: "GUEST" }, user: { disabledAt: null } } });
    const profile = await tx.memberProfile.findFirst({ where: { workspaceId: actor.workspace.id, userId: v.userId }, select: { managerId: true } });
    if (!target || !canRecordAttendance(actor.membership, v.userId === actor.user.id, profile?.managerId === actor.user.id, target.role)) throw unavailable();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`availability:${actor.workspace.id}:${v.userId}`}))`;
    const leave = await approvedLeaveDays(actor, [v.userId], [v.dateOn], tx);
    if (leave.size) throw new OperationsError("This day is covered by approved leave. Update the leave request first.");
    const existing = await tx.attendanceEntry.findFirst({ where: { workspaceId: actor.workspace.id, userId: v.userId, dateOn: new Date(v.dateOn) } });
    if ((existing?.updatedAt.toISOString() ?? "") !== v.version) throw new OperationsError("Attendance changed since you opened it. Refresh and try again.");
    const data = { status: v.status, notes: v.notes, recordedById: actor.user.id };
    const row = await tx.attendanceEntry.upsert({ where: { workspaceId_userId_dateOn: { workspaceId: actor.workspace.id, userId: v.userId, dateOn: new Date(v.dateOn) } }, create: { workspaceId: actor.workspace.id, userId: v.userId, dateOn: new Date(v.dateOn), ...data }, update: data });
    await register(actor, "attendance", row.id, `Attendance ${v.dateOn}`, tx, v.userId); return row.id;
  });
}
export async function profileOrganisation(actor: OpsActor, userId: string) {
  if (actor.membership.role === "GUEST") return null;
  const data = await orgData(actor); const person = data.people.find(p => p.id === userId); if (!person) return null;
  const mine = await responsibilities(actor, { userId });
  return { department: data.departments.find(d => d.id === person.departmentId)?.name ?? null, manager: data.people.find(p => p.id === person.managerId) ?? null, reports: data.people.filter(p => p.managerId === userId), responsibilities: mine.map(r => ({ id: r.id, title: r.title, roles: responsibilityRoles(r, userId) })) };
}
