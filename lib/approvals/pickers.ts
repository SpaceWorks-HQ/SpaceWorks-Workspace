import "server-only";
import { prisma } from "@/lib/db";
import type { OpsActor } from "./context";
import { hiddenTeamIds } from "@/lib/teamAccess";
export async function opsPickers(actor: OpsActor) {
 const hidden = await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role });
 const [members, teams, docs] = await Promise.all([
  prisma.membership.findMany({ where: { workspaceId: actor.workspace.id, status: "ACTIVE", user: { disabledAt: null }, role: { not: "GUEST" } }, select: { user: { select: { id: true, name: true, email: true } } } }),
  prisma.team.findMany({ where: { workspaceId: actor.workspace.id, archivedAt: null, id: { notIn: hidden } }, select: { id: true, name: true } }),
  prisma.doc.findMany({ where: { workspaceId: actor.workspace.id, deletedAt: null, ...(actor.membership.role === "MEMBER" ? { visibility: "WORKSPACE" } : {}) }, select: { id: true, title: true }, take: 500 })
 ]);
 return { members: members.map(m => ({ value: m.user.id, label: m.user.name ?? m.user.email })), teams: teams.map(t => ({ value: t.id, label: t.name })), docs: docs.map(d => ({ value: d.id, label: d.title })) };
}
