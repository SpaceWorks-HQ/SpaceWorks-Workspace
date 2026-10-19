import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { canManageRota, canUseRota } from "@/lib/roles";
import { recordAuditEvent } from "@/lib/audit";
import { idSchema } from "@/lib/validation";
import { activeMemberIdsAmong, isActiveMember, type PeopleActor } from "./context";
export async function saveCertType(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  if (!canManageRota(actor.membership)) return actionError(NOT_ALLOWED);
  const p = z.object({ id: idSchema.optional(), name: z.string().trim().min(1).max(80), description: z.string().trim().max(1000).default(""), validityDays: z.coerce.number().int().min(1).max(3650).nullable().default(null), trainerIds: z.array(idSchema).max(50).default([]), trainerTeamId: idSchema.nullable().default(null) }).safeParse(input);
  if (!p.success) return validationError(p.error);
  if ((await activeMemberIdsAmong(actor.workspace.id, p.data.trainerIds)).length !== new Set(p.data.trainerIds).size) return actionError("Pick active trainers in this workspace.");
  if (p.data.trainerTeamId && !await prisma.team.findFirst({ where: { id: p.data.trainerTeamId, workspaceId: actor.workspace.id, archivedAt: null }, select: { id: true } })) return actionError(NOT_ALLOWED);
  const { id, ...data } = p.data;
  if (id && !await prisma.certType.findFirst({ where: { id, workspaceId: actor.workspace.id }, select: { id: true } })) return actionError(NOT_ALLOWED);
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`people:training:${actor.workspace.id}`}))`;
    if (await tx.certType.findFirst({ where: { workspaceId: actor.workspace.id, name: data.name, ...(id ? { id: { not: id } } : {}) }, select: { id: true } })) return false;
    const row = id ? await tx.certType.update({ where: { id, workspaceId: actor.workspace.id }, data }) : await tx.certType.create({ data: { workspaceId: actor.workspace.id, ...data } });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: id ? "people.cert_type_updated" : "people.cert_type_created", targetType: "CertType", targetId: row.id });
    return true;
  });
  if (!saved) return actionError("A sign-off type already has that name.");
  return { ok: true };
}
export async function grantCertification(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const p = z.object({ certTypeId: idSchema, userId: idSchema }).safeParse(input); if (!p.success) return validationError(p.error);
  if (!canUseRota(actor.membership) || !await isActiveMember(actor.workspace.id, p.data.userId)) return actionError(NOT_ALLOWED);
  const type = await prisma.certType.findFirst({ where: { id: p.data.certTypeId, workspaceId: actor.workspace.id } });
  if (!type) return actionError(NOT_ALLOWED);
  const teamTrainer = type.trainerTeamId && await prisma.teamMember.findFirst({ where: { teamId: type.trainerTeamId, userId: actor.user.id, team: { workspaceId: actor.workspace.id, archivedAt: null } }, select: { userId: true } });
  if (!canManageRota(actor.membership) && (!type.trainerIds.includes(actor.user.id) && !teamTrainer || actor.user.id === p.data.userId)) return actionError(NOT_ALLOWED);
  await prisma.$transaction(async tx => {
    const row = await tx.certification.create({ data: { certTypeId: type.id, userId: p.data.userId, grantedById: actor.user.id, expiresAt: type.validityDays ? new Date(Date.now() + type.validityDays * 86400000) : null } });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.certification_granted", targetType: "Certification", targetId: row.id });
  }); return { ok: true };
}
export async function certifications(actor: PeopleActor, userId?: string) {
  if (!canUseRota(actor.membership)) return [];
  return prisma.certification.findMany({ where: { certType: { workspaceId: actor.workspace.id }, ...(userId ? { userId } : {}), user: { memberships: { some: { workspaceId: actor.workspace.id, status: "ACTIVE" } } } }, select: { id: true, userId: true, grantedAt: true, expiresAt: true, revokedAt: true, certType: { select: { id: true, name: true } }, user: { select: { name: true } } }, orderBy: { grantedAt: "desc" }, take: 300 });
}
export async function revokeCertification(actor: PeopleActor, id: string): Promise<ActionResult> {
  if (!canManageRota(actor.membership) || !idSchema.safeParse(id).success) return actionError(NOT_ALLOWED);
  await prisma.$transaction(async tx => { const row = await tx.certification.updateMany({ where: { id, certType: { workspaceId: actor.workspace.id }, revokedAt: null }, data: { revokedAt: new Date() } }); if (row.count) await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.certification_revoked", targetType: "Certification", targetId: id }); });
  return { ok: true };
}
