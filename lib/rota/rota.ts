import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { canManageRota, canUseRota } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { dispatch } from "@/lib/notify/dispatch";
import { idSchema } from "@/lib/validation";
import { zonedInputToIso } from "@/lib/timeZone";
import { listTeams } from "@/lib/teams/teams";
import { type PeopleActor, isActiveMember } from "@/lib/people/context";
import { OCCUPIED } from "./coverage";
import { weeklyShiftInstances } from "./schedule";

async function visibleTypeIds(actor: PeopleActor) {
  const ids = (await listTeams(actor)).map(t => t.id);
  return { workspaceId: actor.workspace.id, OR: [{ teamId: null }, { teamId: { in: ids } }] };
}
export async function rotaData(actor: PeopleActor, from: Date, to: Date) {
  if (!canUseRota(actor.membership)) return { types: [], shifts: [], certTypes: [] };
  const types = await prisma.shiftType.findMany({ where: await visibleTypeIds(actor), orderBy: { name: "asc" } });
  const shifts = await prisma.shift.findMany({ where: { workspaceId: actor.workspace.id, shiftTypeId: { in: types.map(t => t.id) }, startsAt: { lt: to }, endsAt: { gt: from } }, include: { shiftType: true, assignments: { where: { status: { in: [...OCCUPIED] } }, select: { id: true, userId: true, status: true, user: { select: { name: true } }, swapRequests: { where: { status: "OPEN" }, select: { id: true, toUserId: true, fromUserId: true } } } } }, orderBy: { startsAt: "asc" }, take: 300 });
  const certTypes = await prisma.certType.findMany({ where: { workspaceId: actor.workspace.id }, orderBy: { name: "asc" } });
  return { types, shifts, certTypes };
}
async function canManageType(actor: PeopleActor, teamId: string | null) {
  if (canManageRota(actor.membership)) return true;
  return Boolean(teamId && canUseRota(actor.membership) && await prisma.teamMember.findFirst({ where: { teamId, userId: actor.user.id, role: "LEAD", team: { workspaceId: actor.workspace.id, archivedAt: null } }, select: { teamId: true } }));
}
export async function saveShiftType(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const p = z.object({ id: idSchema.optional(), name: z.string().trim().min(1).max(80), teamId: idSchema.nullable().default(null), defaultCapacity: z.coerce.number().int().min(1).max(100), requiresCertTypeId: idSchema.nullable().default(null), requiresKeyholder: z.boolean().default(false) }).safeParse(input);
  if (!p.success) return validationError(p.error);
  if (!await canManageType(actor, p.data.teamId)) return actionError(NOT_ALLOWED);
  const previous = p.data.id ? await prisma.shiftType.findFirst({ where: { id: p.data.id, workspaceId: actor.workspace.id } }) : null;
  if (p.data.id && (!previous || !await canManageType(actor, previous.teamId))) return actionError(NOT_ALLOWED);
  if (p.data.teamId && !await prisma.team.findFirst({ where: { id: p.data.teamId, workspaceId: actor.workspace.id, archivedAt: null }, select: { id: true } })) return actionError(NOT_ALLOWED);
  if (p.data.requiresCertTypeId && !await prisma.certType.findFirst({ where: { id: p.data.requiresCertTypeId, workspaceId: actor.workspace.id }, select: { id: true } })) return actionError(NOT_ALLOWED);
  const { id, ...data } = p.data;
  const saved = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`rota:templates:${actor.workspace.id}`}))`;
    if (await tx.shiftType.findFirst({ where: { workspaceId: actor.workspace.id, name: data.name, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) return false;
    const row = id ? await tx.shiftType.update({ where: { id, workspaceId: actor.workspace.id }, data }) : await tx.shiftType.create({ data: { workspaceId: actor.workspace.id, ...data } });
    await audit(tx, actor, id ? "template_updated" : "template_created", row.id, "ShiftType");
    return true;
  });
  if (!saved) return actionError("A shift template already has that name.");
  return { ok: true };
}
export async function scheduleShifts(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const p = z.object({ shiftTypeId: idSchema, startsAt: z.string().max(30), endsAt: z.string().max(30), capacity: z.coerce.number().int().min(1).max(100).nullable().default(null), weeks: z.coerce.number().int().min(1).max(12).default(1), location: z.string().trim().max(160).default(""), notes: z.string().trim().max(2000).default("") }).safeParse(input);
  if (!p.success) return validationError(p.error);
  const type = await prisma.shiftType.findFirst({ where: { workspaceId: actor.workspace.id, id: p.data.shiftTypeId } });
  if (!type || !await canManageType(actor, type.teamId)) return actionError(NOT_ALLOWED);
  if (type.teamId && !await prisma.team.findFirst({ where: { id: type.teamId, workspaceId: actor.workspace.id, archivedAt: null }, select: { id: true } })) return actionError("Restore the team before scheduling shifts.");
  const startsAt = zonedInputToIso(p.data.startsAt, actor.workspace.timezone); const endsAt = zonedInputToIso(p.data.endsAt, actor.workspace.timezone);
  if (!startsAt || !endsAt || endsAt <= startsAt || new Date(endsAt).getTime() - new Date(startsAt).getTime() > 86400000) return actionError("Choose a shift lasting up to one day.");
  const instances = weeklyShiftInstances(p.data, actor.workspace.timezone);
  if (!instances) return actionError("A repeat crosses a clock change. Choose different shift times.");
  await prisma.$transaction(async tx => {
    const seriesId = crypto.randomUUID();
    for (let week = 0; week < p.data.weeks; week++) {
      const row = await tx.shift.create({ data: { workspaceId: actor.workspace.id, shiftTypeId: type.id, ...instances[week], capacity: p.data.capacity ?? type.defaultCapacity, location: p.data.location || null, notes: p.data.notes || null, createdById: actor.user.id, seriesId: p.data.weeks > 1 ? seriesId : null, rrule: week === 0 && p.data.weeks > 1 ? `FREQ=WEEKLY;COUNT=${p.data.weeks}` : null } });
      await audit(tx, actor, "scheduled", row.id);
    }
  }); return { ok: true };
}
async function audit(tx: Prisma.TransactionClient, actor: PeopleActor, verb: string, id: string, targetType = "Shift") {
  await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: `rota.${verb}`, targetType, targetId: id });
  await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb, entityType: "shift", entityId: id, summary: "Updated the volunteer rota", visibility: "PRIVATE" }, tx);
}
async function lockUsers(tx: Prisma.TransactionClient, workspaceId: string, ids: string[]) { for (const id of [...new Set(ids)].sort()) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`rota:user:${workspaceId}:${id}`}))`; }
async function eligible(tx: Prisma.TransactionClient, actor: PeopleActor, shift: { id: string; startsAt: Date; endsAt: Date; shiftType: { requiresCertTypeId: string | null; requiresKeyholder: boolean } }, userId: string) {
  if (!await isActiveMember(actor.workspace.id, userId, tx)) return "That person is no longer an active member.";
  const member = await tx.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId, status: "ACTIVE" }, select: { role: true } });
  if (!canUseRota(member)) return "Guests cannot take shifts.";
  if (shift.startsAt <= new Date()) return "This shift has started. Pick an upcoming shift.";
  if (await tx.shiftAssignment.findFirst({ where: { userId, status: { in: [...OCCUPIED] }, shift: { workspaceId: actor.workspace.id, id: { not: shift.id }, startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } } }, select: { id: true } })) return "That overlaps another shift. Choose another time.";
  if (await tx.availability.findFirst({ where: { workspaceId: actor.workspace.id, userId, type: { in: ["AWAY", "BUSY", "TRAVEL"] }, startsAt: { lt: shift.endsAt }, endsAt: { gt: shift.startsAt } }, select: { id: true } })) return "That overlaps approved time off. Choose another shift.";
  if (shift.shiftType.requiresKeyholder && !await tx.memberProfile.findFirst({ where: { workspaceId: actor.workspace.id, userId, isKeyholder: true }, select: { id: true } })) return "This shift needs a keyholder.";
  if (shift.shiftType.requiresCertTypeId && !await tx.certification.findFirst({ where: { certTypeId: shift.shiftType.requiresCertTypeId, certType: { workspaceId: actor.workspace.id }, userId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gte: shift.endsAt } }] }, select: { id: true } })) return "A current training sign-off is needed for this shift.";
  return null;
}
async function loadShift(actor: PeopleActor, id: string) {
  const where = await visibleTypeIds(actor);
  return prisma.shift.findFirst({ where: { workspaceId: actor.workspace.id, id, shiftType: where }, include: { shiftType: true } });
}
export async function signUp(actor: PeopleActor, id: string): Promise<ActionResult> {
  if (!canUseRota(actor.membership) || !idSchema.safeParse(id).success) return actionError(NOT_ALLOWED);
  if (!await loadShift(actor, id)) return actionError(NOT_ALLOWED);
  return prisma.$transaction(async tx => {
    await lockUsers(tx, actor.workspace.id, [actor.user.id]);
    await tx.$queryRaw`SELECT "id" FROM "Shift" WHERE "id"=${id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const shift = await tx.shift.findFirst({ where: { id, workspaceId: actor.workspace.id }, include: { shiftType: true, assignments: { where: { status: { in: [...OCCUPIED] } } } } });
    if (!shift) return actionError(NOT_ALLOWED);
    if (shift.assignments.some(a => a.userId === actor.user.id)) return { ok: true };
    const error = await eligible(tx, actor, shift, actor.user.id); if (error) return actionError(error);
    if (shift.assignments.length >= shift.capacity) return actionError("This shift is full. Pick another shift or ask for a swap.");
    await tx.shiftAssignment.upsert({ where: { shiftId_userId: { shiftId: id, userId: actor.user.id } }, create: { shiftId: id, userId: actor.user.id }, update: { status: "CONFIRMED" } });
    await audit(tx, actor, "signed_up", id); return { ok: true };
  });
}
export async function dropShift(actor: PeopleActor, id: string): Promise<ActionResult> {
  if (!canUseRota(actor.membership) || !await loadShift(actor, id)) return actionError(NOT_ALLOWED);
  return prisma.$transaction(async tx => {
    await lockUsers(tx, actor.workspace.id, [actor.user.id]);
    await tx.$queryRaw`SELECT "id" FROM "Shift" WHERE "id"=${id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const row = await tx.shiftAssignment.findFirst({ where: { userId: actor.user.id, shiftId: id, shift: { workspaceId: actor.workspace.id, startsAt: { gt: new Date() } } } });
    if (!row) return actionError("Only upcoming shifts can be dropped.");
    await tx.shiftAssignment.update({ where: { id: row.id, shift: { workspaceId: actor.workspace.id } }, data: { status: "CANCELLED" } });
    await tx.shiftSwapRequest.updateMany({ where: { assignmentId: row.id, assignment: { shift: { workspaceId: actor.workspace.id } }, status: "OPEN" }, data: { status: "CANCELLED", decidedAt: new Date() } });
    await audit(tx, actor, "dropped", id); return { ok: true };
  });
}
export async function requestSwap(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const p = z.object({ shiftId: idSchema, toUserId: idSchema.nullable().default(null) }).safeParse(input); if (!p.success) return validationError(p.error);
  const shift = await loadShift(actor, p.data.shiftId);
  if (!canUseRota(actor.membership) || !shift || shift.startsAt <= new Date()) return actionError(NOT_ALLOWED);
  if (p.data.toUserId === actor.user.id || (p.data.toUserId && !await isActiveMember(actor.workspace.id, p.data.toUserId))) return actionError("Pick another active member.");
  if (p.data.toUserId && shift.shiftType.teamId) { const team = await prisma.team.findFirst({ where: { id: shift.shiftType.teamId, workspaceId: actor.workspace.id }, select: { visibility: true, members: { where: { userId: p.data.toUserId }, select: { userId: true } } } }); if (team?.visibility === "PRIVATE" && !team.members.length) return actionError("Pick a member of this team."); }
  const outcome = await prisma.$transaction(async tx => {
    await lockUsers(tx, actor.workspace.id, [actor.user.id]);
    const assignment = await tx.shiftAssignment.findFirst({ where: { shiftId: shift.id, userId: actor.user.id, status: { in: ["CONFIRMED", "SWAP_REQUESTED"] }, shift: { workspaceId: actor.workspace.id } } });
    if (!assignment) return null;
    if (await tx.shiftSwapRequest.findFirst({ where: { assignmentId: assignment.id, status: "OPEN", assignment: { shift: { workspaceId: actor.workspace.id } } } })) return null;
    const swap = await tx.shiftSwapRequest.create({ data: { assignmentId: assignment.id, fromUserId: actor.user.id, toUserId: p.data.toUserId } });
    await tx.shiftAssignment.update({ where: { id: assignment.id, shift: { workspaceId: actor.workspace.id } }, data: { status: "SWAP_REQUESTED" } });
    await audit(tx, actor, "swap_requested", shift.id);
    return dispatch(actor.workspace.id, { type: "shift.swap_requested", title: "Can you cover a volunteer shift?", actorId: actor.user.id, recipients: p.data.toUserId ? [p.data.toUserId] : [], useWorkspaceRules: false, resource: { type: "shift", id: shift.id }, url: `/w/${actor.workspace.slug}/rota`, data: { swapRequestId: swap.id, shiftId: shift.id } }, { tx });
  });
  if (!outcome) return actionError("You already requested a swap or no longer hold this shift.");
  await outcome.afterCommit(); return { ok: true };
}
export async function acceptSwap(actor: PeopleActor, id: string): Promise<ActionResult> {
  if (!canUseRota(actor.membership) || !idSchema.safeParse(id).success) return actionError(NOT_ALLOWED);
  const swap = await prisma.shiftSwapRequest.findFirst({ where: { id, status: "OPEN", assignment: { shift: { workspaceId: actor.workspace.id } } }, include: { assignment: true } });
  if (!swap || swap.fromUserId === actor.user.id || (swap.toUserId && swap.toUserId !== actor.user.id) || !await loadShift(actor, swap.assignment.shiftId)) return actionError(NOT_ALLOWED);
  const outcome = await prisma.$transaction(async tx => {
    await lockUsers(tx, actor.workspace.id, [actor.user.id, swap.fromUserId]);
    await tx.$queryRaw`SELECT "id" FROM "Shift" WHERE "id"=${swap.assignment.shiftId} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const current = await tx.shiftSwapRequest.findFirst({ where: { id, status: "OPEN", assignment: { status: "SWAP_REQUESTED", shift: { workspaceId: actor.workspace.id } } } });
    if (!current) return { result: actionError("That swap is no longer open."), notify: null };
    const shift = await tx.shift.findFirstOrThrow({ where: { id: swap.assignment.shiftId, workspaceId: actor.workspace.id }, include: { shiftType: true } });
    if (await tx.shiftAssignment.findFirst({ where: { userId: actor.user.id, shiftId: shift.id, status: { in: [...OCCUPIED] } }, select: { id: true } })) return { result: actionError("You already hold this shift."), notify: null };
    const error = await eligible(tx, actor, shift, actor.user.id); if (error) return { result: actionError(error), notify: null };
    await tx.shiftAssignment.update({ where: { id: swap.assignmentId, shift: { workspaceId: actor.workspace.id } }, data: { status: "CANCELLED" } });
    await tx.shiftAssignment.upsert({ where: { shiftId_userId: { shiftId: shift.id, userId: actor.user.id } }, create: { shiftId: shift.id, userId: actor.user.id }, update: { status: "CONFIRMED" } });
    await tx.shiftSwapRequest.update({ where: { id, assignment: { shift: { workspaceId: actor.workspace.id } } }, data: { status: "ACCEPTED", decidedAt: new Date() } });
    await audit(tx, actor, "swap_accepted", shift.id);
    const notify = await dispatch(actor.workspace.id, { type: "shift.swap_accepted", title: "Your volunteer shift is covered", actorId: actor.user.id, recipients: [swap.fromUserId], useWorkspaceRules: false, resource: { type: "shift", id: shift.id }, url: `/w/${actor.workspace.slug}/rota`, data: { swapRequestId: id, shiftId: shift.id } }, { tx });
    return { result: { ok: true } as ActionResult, notify };
  });
  await outcome.notify?.afterCommit(); return outcome.result;
}
