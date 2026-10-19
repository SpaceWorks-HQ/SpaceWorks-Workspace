import "server-only";

import type { Prisma, TeamRole } from "@prisma/client";
import { actionError, NOT_ALLOWED, validationError, type ActionResult } from "@/lib/actionResult";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify/dispatch";
import { publish } from "@/lib/realtime";
import { indexSearchDocument } from "@/lib/search/documents";
import { slugify, withSlugSuffix } from "@/lib/slug";
import { canAdministerTeams, canJoinTeam, canManageTeamMembers, canSeeTeam } from "@/lib/people/access";
import { startAutoChecklists } from "@/lib/people/checklists";
import { displayName, type PeopleActor } from "@/lib/people/context";
import { canSeeMemberEmails } from "@/lib/people/access";
import { archiveTeamSchema, teamInputSchema, teamMemberInputSchema, teamMemberRefSchema, teamRefSchema } from "@/lib/teams/validation";

/**
 * Teams: crews inside the community (ops, events, infra, comms). Admins
 * create, edit and archive them; team leads manage their own members;
 * members join and leave public teams themselves. A PRIVATE team (and its
 * channels and projects, through `lib/teamAccess`) is invisible to anyone
 * outside it except admins.
 */

export const teamUrl = (slug: string, teamSlug: string) => `/w/${slug}/teams/${teamSlug}`;

const memberSelect = { userId: true, role: true, joinedAt: true, user: { select: { id: true, name: true, email: true, image: true } } } as const;

/** Teams the actor may see, with member counts and the actor's own role. */
export async function listTeams(actor: PeopleActor, options: { includeArchived?: boolean } = {}) {
  const teams = await prisma.team.findMany({
    where: { workspaceId: actor.workspace.id, ...(options.includeArchived && canAdministerTeams(actor.membership) ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      color: true,
      description: true,
      visibility: true,
      archivedAt: true,
      _count: { select: { members: { where: { user: { memberships: { some: { workspaceId: actor.workspace.id, status: "ACTIVE" } } } } }, channels: true, projects: true } },
      members: { where: { userId: actor.user.id }, select: { role: true }, take: 1 },
    },
  });
  return teams
    .map(({ members, _count, ...team }) => ({ ...team, myRole: (members[0]?.role ?? null) as TeamRole | null, counts: _count }))
    .filter((team) => canSeeTeam(actor.membership, team, team.myRole !== null));
}

/** One team by slug, or null when it doesn't exist or the actor may not see it. */
export async function getTeam(actor: PeopleActor, teamSlug: string) {
  if (typeof teamSlug !== "string" || teamSlug.length > 80) return null;
  const team = await prisma.team.findUnique({
    where: { workspaceId_slug: { workspaceId: actor.workspace.id, slug: teamSlug } },
    select: {
      id: true,
      name: true,
      slug: true,
      color: true,
      description: true,
      visibility: true,
      archivedAt: true,
      createdAt: true,
      members: { orderBy: [{ role: "asc" }, { joinedAt: "asc" }], select: memberSelect },
    },
  });
  if (!team) return null;
  // Only people who are still active here count as members on the page.
  const active = new Set(
    (await prisma.membership.findMany({ where: { workspaceId: actor.workspace.id, status: "ACTIVE", userId: { in: team.members.map((m) => m.userId) } }, select: { userId: true } })).map((row) => row.userId),
  );
  const members = team.members.filter((member) => active.has(member.userId));
  const myRole = (team.members.find((member) => member.userId === actor.user.id)?.role ?? null) as TeamRole | null;
  if (!canSeeTeam(actor.membership, team, myRole !== null)) return null;
  return { ...team, members: members.map(m => ({ ...m, user: { ...m.user, email: canSeeMemberEmails(actor.membership) ? m.user.email : "" } })), myRole };
}

/** Channels and projects tied to a team, filtered for the actor (private channels only for their members). */
export async function teamWork(actor: PeopleActor, teamId: string) {
  const visible = (await listTeams(actor, { includeArchived: true })).some(t => t.id === teamId);
  if (!visible) return { channels: [], projects: [] };
  const [channels, projects] = await Promise.all([
    prisma.channel.findMany({
      where: {
        workspaceId: actor.workspace.id,
        teamId,
        archivedAt: null,
        ...(actor.membership.role === "GUEST" ? { members: { some: { userId: actor.user.id } } } : { OR: [{ kind: "PUBLIC" as const }, { kind: "PRIVATE" as const, members: { some: { userId: actor.user.id } } }] }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, topic: true, kind: true },
    }),
    prisma.project.findMany({
      where: { workspaceId: actor.workspace.id, teamId, status: { not: "ARCHIVED" } },
      orderBy: { name: "asc" },
      select: { id: true, key: true, name: true, status: true, dueOn: true },
    }),
  ]);
  return { channels, projects };
}

async function uniqueSlug(tx: Prisma.TransactionClient, workspaceId: string, name: string, exceptId: string | null) {
  const base = slugify(name, "team");
  for (let suffix = 0; suffix < 50; suffix += 1) {
    const slug = withSlugSuffix(base, suffix);
    const taken = await tx.team.findFirst({ where: { workspaceId, slug, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

async function indexTeam(tx: Prisma.TransactionClient, actor: PeopleActor, team: { id: string; name: string; slug: string; description: string | null; visibility: "PUBLIC" | "PRIVATE"; archivedAt: Date | null }) {
  await indexSearchDocument(
    {
      workspaceId: actor.workspace.id,
      entityType: "team",
      entityId: team.id,
      title: team.archivedAt ? `${team.name} (archived)` : team.name,
      body: team.description ?? "",
      url: teamUrl(actor.workspace.slug, team.slug),
      visibility: team.visibility === "PRIVATE" ? "TEAM" : "WORKSPACE",
      teamId: team.visibility === "PRIVATE" ? team.id : null,
    },
    tx,
  );
}

/** Create (teamId null) or edit a team. Admins only. The creator becomes its first lead. */
export async function saveTeam(actor: PeopleActor, input: unknown, teamId: string | null): Promise<ActionResult<{ id: string; slug: string }>> {
  if (!canAdministerTeams(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = teamInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const data = parsed.data;

  const saved = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`teams:${actor.workspace.id}`}))`;
    if (teamId) {
      const existing = await tx.team.findFirst({ where: { id: teamId, workspaceId: actor.workspace.id }, select: { id: true, name: true } });
      if (!existing) return null;
      const team = await tx.team.update({ where: { id: teamId, workspaceId: actor.workspace.id }, data });
      await indexTeam(tx, actor, team);
      await recordAuditEvent({ client: tx, action: "team.updated", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Team", targetId: team.id, metadata: { visibility: team.visibility } });
      return team;
    }
    const slug = await uniqueSlug(tx, actor.workspace.id, data.name, null);
    const team = await tx.team.create({
      data: { workspaceId: actor.workspace.id, ...data, slug, createdById: actor.user.id, members: { create: { userId: actor.user.id, role: "LEAD" } } },
    });
    await indexTeam(tx, actor, team);
    await recordActivity(
      {
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        verb: "created",
        entityType: "team",
        entityId: team.id,
        summary: `${displayName(actor.user.name)} started the ${team.name} team`,
        visibility: team.visibility === "PRIVATE" ? "TEAM" : "WORKSPACE",
        teamId: team.id,
      },
      tx,
    );
    await recordAuditEvent({ client: tx, action: "team.created", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Team", targetId: team.id, metadata: { visibility: team.visibility } });
    return team;
  });
  if (!saved) return actionError("That team no longer exists.");
  await publish(actor.workspace.id, "workspace", { type: "people.team.changed", data: { teamId: saved.id } });
  return { ok: true, data: { id: saved.id, slug: saved.slug } };
}

/** Archive or restore a team. Archived teams disappear from lists and stop gating anything. */
export async function setTeamArchived(actor: PeopleActor, input: unknown): Promise<ActionResult<{ slug: string }>> {
  if (!canAdministerTeams(actor.membership)) return actionError(NOT_ALLOWED);
  const parsed = archiveTeamSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const team = await prisma.team.findFirst({ where: { id: parsed.data.teamId, workspaceId: actor.workspace.id } });
  if (!team) return actionError("That team no longer exists.");
  if (Boolean(team.archivedAt) === parsed.data.archived) return { ok: true, data: { slug: team.slug } };
  await prisma.$transaction(async (tx) => {
    const updated = await tx.team.update({ where: { id: team.id, workspaceId: actor.workspace.id }, data: { archivedAt: parsed.data.archived ? new Date() : null } });
    await indexTeam(tx, actor, updated);
    await recordAuditEvent({ client: tx, action: parsed.data.archived ? "team.archived" : "team.restored", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Team", targetId: team.id });
  });
  await publish(actor.workspace.id, "workspace", { type: "people.team.changed", data: { teamId: team.id } });
  return { ok: true, data: { slug: team.slug } };
}

async function loadTeamForMembers(actor: PeopleActor, teamId: string) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, workspaceId: actor.workspace.id },
    select: { id: true, name: true, slug: true, visibility: true, archivedAt: true, members: { where: { userId: actor.user.id }, select: { role: true } } },
  });
  if (!team) return null;
  const myRole = (team.members[0]?.role ?? null) as TeamRole | null;
  if (!canSeeTeam(actor.membership, team, myRole !== null)) return null;
  return { ...team, myRole };
}

/** Add someone to a team (admins and the team's leads). Starts any checklist set to auto-start for this team. */
export async function addTeamMember(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const parsed = teamMemberInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const team = await loadTeamForMembers(actor, parsed.data.teamId);
  if (!team) return actionError("That team no longer exists.");
  if (!canManageTeamMembers(actor.membership, team.myRole)) return actionError(NOT_ALLOWED);
  if (team.archivedAt) return actionError("This team is archived. Restore it before adding people.");
  const { userId, role } = parsed.data;
  const target = await prisma.membership.findFirst({ where: { workspaceId: actor.workspace.id, userId, status: "ACTIVE" }, select: { user: { select: { name: true, email: true } } } });
  if (!target) return actionError("That person isn't an active member here.", { userId: ["Pick a member of this workspace."] });

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id"=${team.id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const existing = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: team.id, userId }, team: { workspaceId: actor.workspace.id } }, select: { role: true } });
    if (existing) {
      if (existing.role !== role) {
        await tx.teamMember.update({ where: { teamId_userId: { teamId: team.id, userId }, team: { workspaceId: actor.workspace.id } }, data: { role } });
        await recordAuditEvent({ client: tx, action: "team.role_changed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Team", targetId: team.id, metadata: { role } });
      }
      return { added: false, result: null };
    }
    await tx.teamMember.create({ data: { teamId: team.id, userId, role } });
    await recordAuditEvent({ client: tx, action: "team.member_added", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Team", targetId: team.id, metadata: { role, self: userId === actor.user.id } });
    await recordActivity(
      {
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        verb: "joined",
        entityType: "team",
        entityId: team.id,
        summary: `${displayName(target.user.name, target.user.email)} joined ${team.name}`,
        visibility: team.visibility === "PRIVATE" ? "TEAM" : "WORKSPACE",
        teamId: team.id,
        data: { userId },
      },
      tx,
    );
    const runs = await startAutoChecklists(tx, { workspace: actor.workspace, subjectUserId: userId, trigger: { teamId: team.id }, actorId: actor.user.id });
    const result =
      userId === actor.user.id
        ? null
        : await dispatch(
            actor.workspace.id,
            {
              type: "team.member_added",
              title: `${displayName(actor.user.name)} added you to ${team.name}`.slice(0, 150),
              url: teamUrl(actor.workspace.slug, team.slug),
              actorId: actor.user.id,
              recipients: [userId],
              useWorkspaceRules: false,
              resource: { type: "team", id: team.id },
              scope: { teamId: team.id },
              data: { teamId: team.id, userId },
            },
            { tx },
          );
    return { added: true, result, runs };
  });
  if (outcome.result) await outcome.result.afterCommit();
  for (const after of outcome.runs ?? []) await after();
  await publish(actor.workspace.id, "workspace", { type: "people.team.changed", data: { teamId: team.id } });
  return { ok: true };
}

/** Remove someone (admins and leads), or leave yourself. */
export async function removeTeamMember(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const parsed = teamMemberRefSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const team = await loadTeamForMembers(actor, parsed.data.teamId);
  if (!team) return actionError("That team no longer exists.");
  const leaving = parsed.data.userId === actor.user.id;
  if (!leaving && !canManageTeamMembers(actor.membership, team.myRole)) return actionError(NOT_ALLOWED);
  const removed = await prisma.$transaction(async (tx) => {
    const deleted = await tx.teamMember.deleteMany({ where: { teamId: team.id, userId: parsed.data.userId, team: { workspaceId: actor.workspace.id } } });
    if (deleted.count === 0) return false;
    await recordAuditEvent({ client: tx, action: leaving ? "team.member_left" : "team.member_removed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Team", targetId: team.id });
    return true;
  });
  if (removed) await publish(actor.workspace.id, "workspace", { type: "people.team.changed", data: { teamId: team.id } });
  return { ok: true };
}

/** Change someone's team role (lead or member). */
export async function setTeamMemberRole(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const parsed = teamMemberInputSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const team = await loadTeamForMembers(actor, parsed.data.teamId);
  if (!team) return actionError("That team no longer exists.");
  if (!canManageTeamMembers(actor.membership, team.myRole)) return actionError(NOT_ALLOWED);
  if (team.archivedAt) return actionError("This team is archived. Restore it before changing roles.");
  return prisma.$transaction(async tx => {
    const updated = await tx.teamMember.updateMany({ where: { teamId: team.id, userId: parsed.data.userId, team: { workspaceId: actor.workspace.id } }, data: { role: parsed.data.role } });
    if (updated.count === 0) return actionError("That person isn't on this team any more.");
    await recordAuditEvent({ client: tx, action: "team.role_changed", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Team", targetId: team.id, metadata: { role: parsed.data.role } });
    return { ok: true };
  });
}

/** Join a public team yourself. */
export async function joinTeam(actor: PeopleActor, input: unknown): Promise<ActionResult> {
  const parsed = teamRefSchema.safeParse(input);
  if (!parsed.success) return validationError(parsed.error);
  const team = await loadTeamForMembers(actor, parsed.data.teamId);
  if (!team) return actionError("That team no longer exists.");
  if (!canJoinTeam(actor.membership, team)) return actionError(team.visibility === "PRIVATE" ? "Private teams are invite-only. Ask a lead to add you." : NOT_ALLOWED);
  if (team.myRole) return { ok: true };
  // Joining yourself is adding yourself as a member; the team-member rule is bypassed on purpose.
  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id"=${team.id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
    const existing = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: team.id, userId: actor.user.id }, team: { workspaceId: actor.workspace.id } }, select: { userId: true } });
    if (existing) return [];
    await tx.teamMember.create({ data: { teamId: team.id, userId: actor.user.id, role: "MEMBER" } });
    await recordAuditEvent({ client: tx, action: "team.member_joined", workspaceId: actor.workspace.id, actorId: actor.user.id, targetType: "Team", targetId: team.id });
    await recordActivity(
      { workspaceId: actor.workspace.id, actorId: actor.user.id, verb: "joined", entityType: "team", entityId: team.id, summary: `${displayName(actor.user.name)} joined ${team.name}`, teamId: team.id, data: { userId: actor.user.id } },
      tx,
    );
    return startAutoChecklists(tx, { workspace: actor.workspace, subjectUserId: actor.user.id, trigger: { teamId: team.id }, actorId: actor.user.id });
  });
  for (const after of outcome) await after();
  await publish(actor.workspace.id, "workspace", { type: "people.team.changed", data: { teamId: team.id } });
  return { ok: true };
}
