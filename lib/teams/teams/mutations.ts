import "server-only";
import type { Prisma } from "@prisma/client";
import {
  actionError,
  NOT_ALLOWED,
  validationError,
  type ActionResult,
} from "@/lib/actionResult";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { indexSearchDocument } from "@/lib/search/documents";
import { slugify, withSlugSuffix } from "@/lib/slug";
import { canAdministerTeams } from "@/lib/people/access";
import { displayName, type PeopleActor } from "@/lib/people/context";
import { archiveTeamSchema, teamInputSchema } from "@/lib/teams/validation";
import { teamUrl } from "./links";

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
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`teams:${actor.workspace.id}`}))`;
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
