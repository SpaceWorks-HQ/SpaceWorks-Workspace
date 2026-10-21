import "server-only";
import type { TeamRole } from "@prisma/client";
import {
  actionError,
  NOT_ALLOWED,
  validationError,
  type ActionResult,
} from "@/lib/actionResult";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify/dispatch";
import { publish } from "@/lib/realtime";
import { canJoinTeam, canManageTeamMembers, canSeeTeam } from "@/lib/people/access";
import { startAutoChecklists } from "@/lib/people/checklists";
import { displayName, type PeopleActor } from "@/lib/people/context";
import { teamMemberInputSchema, teamMemberRefSchema, teamRefSchema } from "@/lib/teams/validation";
import { teamUrl } from "./links";

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
