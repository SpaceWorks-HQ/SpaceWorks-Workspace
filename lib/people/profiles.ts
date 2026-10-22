import "server-only";

import { z } from "zod";
import type { Prisma, WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import { indexSearchDocument } from "@/lib/search/documents";
import { canActOnMember, canManageMembers } from "@/lib/roles";
import { canSeeEmergencyContact, canSeeMemberEmails } from "./access";
import { type PeopleActor, isActiveMember } from "./context";
import { listTeams } from "@/lib/teams/teams";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { startAutoChecklists } from "./checklists";

const text = (max: number) => z.string().trim().max(max).default("");
export const profileSchema = z.object({ contactPhone: z.string().trim().max(60).optional(), contactHandle: z.string().trim().max(120).optional(), contactVisibility: z.enum(["PRIVATE", "WORKSPACE"]).optional(), bio: text(2000), pronouns: text(60), timezone: text(80).refine(v => { try { if (v) new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; } }, "Pick a valid time zone."), location: text(120), interests: z.array(text(40)).max(30).default([]), skills: z.array(z.object({ skill: z.string().trim().toLowerCase().min(1).max(60), level: z.coerce.number().int().min(1).max(3) })).max(40).default([]) });
const emergencySchema = z.object({ name: z.string().trim().min(1).max(100), relation: text(80), phone: z.string().trim().min(3).max(60), notes: text(500) });
export type EmergencyContact = z.infer<typeof emergencySchema>;
export function profileFields(handles: unknown) {
  const h = handles && typeof handles === "object" && !Array.isArray(handles) ? handles as Record<string, unknown> : {};
  const p = h.profile && typeof h.profile === "object" ? h.profile as Record<string, unknown> : {};
  return { bio: typeof p.bio === "string" ? p.bio : null, pronouns: typeof p.pronouns === "string" ? p.pronouns : null, timezone: typeof p.timezone === "string" ? p.timezone : null, title: typeof h.title === "string" ? h.title : null, adminNotes: typeof h.adminNotes === "string" ? h.adminNotes : "" };
}
const memberSelect = { userId: true, role: true, title: true, joinedAt: true, user: { select: { id: true, name: true, email: true, image: true, bio: true, pronouns: true, timezone: true } } } as const;
export async function listMembers(actor: PeopleActor, filters: { q?: string; role?: string; skill?: string; team?: string; userId?: string } = {}) {
  const teams = await listTeams(actor);
  const team = filters.team ? teams.find(t => t.id === filters.team) : null;
  if (filters.team && !team) return [];
  const [profiles, teamMembers] = await Promise.all([
    prisma.memberProfile.findMany({ where: { workspaceId: actor.workspace.id }, select: { userId: true, location: true, handles: true, skills: { where: { workspaceId: actor.workspace.id }, select: { skill: true, level: true } } } }),
    prisma.teamMember.findMany({ where: { team: { workspaceId: actor.workspace.id, id: { in: teams.map(t => t.id) } } }, select: { userId: true, teamId: true } }),
  ]);
  const byUser = new Map(profiles.map(p => [p.userId, p]));
  const q = filters.q?.trim().toLowerCase().slice(0, 120) ?? "";
  const clauses: Prisma.MembershipWhereInput[] = [];
  if (filters.userId) clauses.push({ userId: filters.userId });
  if (filters.role) {
    if (!["OWNER", "ADMIN", "MEMBER", "GUEST"].includes(filters.role)) return [];
    clauses.push({ role: filters.role as WorkspaceRole });
  }
  if (team) clauses.push({ userId: { in: teamMembers.filter(m => m.teamId === team.id).map(m => m.userId) } });
  if (filters.skill) clauses.push({ userId: { in: profiles.filter(p => p.skills.some(s => s.skill === filters.skill!.toLowerCase())).map(p => p.userId) } });
  if (q) {
    const profileIds = profiles.filter(p => { const f = profileFields(p.handles); return [f.bio, f.title, p.location, ...p.skills.map(s => s.skill)].some(v => v?.toLowerCase().includes(q)); }).map(p => p.userId);
    clauses.push({ OR: [{ userId: { in: profileIds } }, { title: { contains: q, mode: "insensitive" } }, { user: { name: { contains: q, mode: "insensitive" } } }, { user: { bio: { contains: q, mode: "insensitive" } } }, ...(canSeeMemberEmails(actor.membership) ? [{ user: { email: { contains: q, mode: "insensitive" as const } } }] : [])] });
  }
  const members = await prisma.membership.findMany({ where: { workspaceId: actor.workspace.id, status: "ACTIVE", AND: clauses }, select: memberSelect, orderBy: [{ user: { name: "asc" } }, { userId: "asc" }], take: 1000 });
  return members.map(m => {
    const profile = byUser.get(m.userId); const fields = profileFields(profile?.handles);
    return { id: m.userId, name: m.user.name || "Former member", email: canSeeMemberEmails(actor.membership) ? m.user.email : null, image: m.user.image, role: m.role, title: fields.title ?? m.title, bio: fields.bio ?? m.user.bio, pronouns: fields.pronouns ?? m.user.pronouns, timezone: fields.timezone ?? m.user.timezone, location: profile?.location ?? null, skills: profile?.skills ?? [], joinedAt: m.joinedAt, teams: teams.filter(t => teamMembers.some(tm => tm.userId === m.userId && tm.teamId === t.id)) };
  }).filter(m => (!filters.role || m.role === filters.role) && (!filters.skill || m.skills.some(s => s.skill === filters.skill!.toLowerCase())) && (!team || m.teams.some(t => t.id === team.id)) && (!q || [m.name, m.email, m.title, m.bio, m.location, ...m.skills.map(s => s.skill)].some(v => v?.toLowerCase().includes(q))));
}
export async function memberProfile(actor: PeopleActor, userId: string) {
  const member = (await listMembers(actor, { userId })).find(m => m.id === userId);
  if (!member) return null;
  const hidden = await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role });
  const [profile, activity] = await Promise.all([
    prisma.memberProfile.findFirst({ where: { workspaceId: actor.workspace.id, userId }, select: { contactPhone: true, contactHandle: true, contactVisibility: true, handles: true, interests: true, isKeyholder: true, membershipType: true, engagementType: true, engagementStart: true, engagementEnd: true, emergencyUpdatedAt: true } }),
    prisma.activityEvent.findMany({ where: { workspaceId: actor.workspace.id, actorId: userId, visibility: "WORKSPACE", OR: [{ teamId: null }, { teamId: { notIn: hidden } }], projectId: null }, orderBy: { createdAt: "desc" }, take: 12, select: { id: true, summary: true, createdAt: true } }),
  ]);
  const contactAllowed = actor.membership.role !== "GUEST" && (profile?.contactVisibility === "WORKSPACE" || canManageMembers(actor.membership)) || actor.user.id === userId;
  return { ...member, contactPhone: contactAllowed ? profile?.contactPhone ?? null : null, contactHandle: contactAllowed ? profile?.contactHandle ?? null : null, contactVisibility: profile?.contactVisibility ?? "PRIVATE", engagementType: profile?.engagementType ?? "VOLUNTEER", engagementStart: profile?.engagementStart ?? null, engagementEnd: profile?.engagementEnd ?? null, interests: profile?.interests ?? [], membershipType: profile?.membershipType ?? "MEMBER", isKeyholder: profile?.isKeyholder ?? false, hasEmergency: Boolean(profile?.emergencyUpdatedAt), adminNotes: canManageMembers(actor.membership) ? profileFields(profile?.handles).adminNotes : undefined, activity };
}
export async function saveOwnProfile(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  if (!await isActiveMember(actor.workspace.id, actor.user.id)) return actionError(NOT_ALLOWED);
  const { skills, bio, pronouns, timezone, ...data } = parsed.data;
  if (new Set(skills.map(s => s.skill)).size !== skills.length) return actionError("Use each skill once.");
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`profile:${actor.workspace.id}:${actor.user.id}`}))`;
    const old = await tx.memberProfile.findFirst({ where: { workspaceId: actor.workspace.id, userId: actor.user.id }, select: { handles: true } });
    const handles = { ...(old?.handles as Prisma.JsonObject ?? {}), profile: { bio, pronouns, timezone } };
    const profile = await tx.memberProfile.upsert({ where: { workspaceId_userId: { workspaceId: actor.workspace.id, userId: actor.user.id } }, create: { workspaceId: actor.workspace.id, userId: actor.user.id, ...data, handles }, update: { ...data, handles } });
    await tx.memberSkill.deleteMany({ where: { workspaceId: actor.workspace.id, profileId: profile.id } });
    if (skills.length) await tx.memberSkill.createMany({ data: skills.map(s => ({ ...s, workspaceId: actor.workspace.id, profileId: profile.id })) });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.profile_updated", targetType: "MemberProfile", targetId: profile.id });
    await indexSearchDocument({ workspaceId: actor.workspace.id, entityType: "member", entityId: profile.id, title: actor.user.name || "Member", body: [bio, ...skills.map(s => s.skill)].join(" "), url: `/w/${actor.workspace.slug}/members/${actor.user.id}` }, tx);
    await recordActivity({ workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "updated", entityType: "member", entityId: actor.user.id, summary: `${actor.user.name || "A member"} updated their profile` }, tx);
  });
  return { ok: true };
}
export async function saveAdminProfile(actor: PeopleActor, userId: string, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ title: text(100), notes: text(4000), isKeyholder: z.boolean(), membershipType: z.enum(["CORE", "VOLUNTEER", "MEMBER", "ALUMNI"]) }).safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const target = await prisma.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId, status: "ACTIVE" } });
  if (!target || !canActOnMember(actor.membership, target.role)) return actionError(NOT_ALLOWED);
  const callbacks = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`profile:${actor.workspace.id}:${userId}`}))`;
    const old = await tx.memberProfile.findFirst({ where: { workspaceId: actor.workspace.id, userId }, select: { handles: true, membershipType: true } });
    const { title, notes, ...data } = parsed.data;
    const handles = { ...(old?.handles as Prisma.JsonObject ?? {}), title, adminNotes: notes };
    await tx.memberProfile.upsert({ where: { workspaceId_userId: { workspaceId: actor.workspace.id, userId } }, create: { workspaceId: actor.workspace.id, userId, ...data, handles }, update: { ...data, handles } });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.admin_profile_updated", targetType: "MemberProfile", targetId: userId });
    return old?.membershipType !== data.membershipType ? startAutoChecklists(tx, { workspace: actor.workspace, subjectUserId: userId, trigger: { membershipType: data.membershipType }, actorId: actor.user.id }) : [];
  });
  for (const after of callbacks) await after();
  return { ok: true };
}
export async function saveEmergencyContact(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const parsed = input === null ? null : emergencySchema.safeParse(input);
  if (parsed && !parsed.success) return validationError(parsed.error);
  if (!await isActiveMember(actor.workspace.id, actor.user.id)) return actionError(NOT_ALLOWED);
  const emergencyContactEnc = parsed?.success ? encryptSecret("member-emergency", JSON.stringify(parsed.data)) : null;
  await prisma.$transaction(async tx => {
    await tx.memberProfile.upsert({ where: { workspaceId_userId: { workspaceId: actor.workspace.id, userId: actor.user.id } }, create: { workspaceId: actor.workspace.id, userId: actor.user.id, emergencyContactEnc, emergencyUpdatedAt: emergencyContactEnc ? new Date() : null }, update: { emergencyContactEnc, emergencyUpdatedAt: emergencyContactEnc ? new Date() : null } });
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.emergency_updated", targetType: "MemberProfile", targetId: actor.user.id });
  });
  return { ok: true };
}
export async function revealEmergencyContact(actor: PeopleActor, userId: string): Promise<ActionResult<EmergencyContact | null>> {
  if (!canSeeEmergencyContact(actor.membership, actor.user.id === userId) || !await isActiveMember(actor.workspace.id, userId) || !await isActiveMember(actor.workspace.id, actor.user.id)) return actionError(NOT_ALLOWED);
  return prisma.$transaction(async tx => {
    const profile = await tx.memberProfile.findFirst({ where: { workspaceId: actor.workspace.id, userId }, select: { emergencyContactEnc: true, id: true } });
    const contact = profile?.emergencyContactEnc ? emergencySchema.parse(JSON.parse(decryptSecret("member-emergency", profile.emergencyContactEnc))) : null;
    await recordAuditEvent({ client: tx, workspaceId: actor.workspace.id, actorId: actor.user.id, action: "people.emergency_viewed", targetType: "MemberProfile", targetId: profile?.id ?? userId });
    return { ok: true, data: contact };
  });
}
