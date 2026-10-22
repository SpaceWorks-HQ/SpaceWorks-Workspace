import "server-only";
import type { TeamRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { canAdministerTeams, canSeeTeam } from "@/lib/people/access";
import { type PeopleActor } from "@/lib/people/context";
import { canSeeMemberEmails } from "@/lib/people/access";

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
