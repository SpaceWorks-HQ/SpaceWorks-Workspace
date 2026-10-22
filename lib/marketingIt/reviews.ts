import "server-only";
import { z } from "zod";
import { prisma, type Tx } from "@/lib/db";
import { canManageItAdministration } from "@/lib/roles";
import { lock, readRecord, ensure, audit, sync, type Actor } from "./service";
import { id, object } from "./schema";
/** A dated inventory, including inherited team/role grants; no secret or bearer values are selected. */
export async function snapshotReview(actor: Actor, tx: Tx, recordId: string) {
 const workspaceId = actor.workspace.id;
 const [members, teams, grants, integrations, tokens, licences, socialAccounts] = await Promise.all([
  tx.membership.findMany({ where: { workspaceId }, select: { id: true, userId: true, role: true, status: true, user: { select: { name: true } } } }),
  tx.teamMember.findMany({ where: { team: { workspaceId, archivedAt: null } }, select: { teamId: true, userId: true, role: true, team: { select: { id: true, name: true } } } }),
  tx.vaultGrant.findMany({ where: { workspaceId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true, principalType: true, principalId: true, permission: true } }),
  tx.integrationConnection.findMany({ where: { workspaceId, status: "ACTIVE" }, select: { id: true, connectedById: true, provider: true, accountLabel: true } }),
  tx.apiToken.findMany({ where: { workspaceId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true, createdById: true, name: true } }),
  tx.marketingItRecord.findMany({ where: { workspaceId, kind: "LICENCE", archivedAt: null, status: "ACTIVE" }, select: { id: true, title: true, details: true } }),
  tx.socialAccount.findMany({ where: { workspaceId, status: { in: ["ACTIVE", "DEMO"] } }, select: { id: true, connectedById: true, platform: true, displayName: true } }),
 ]);
 const rows: Array<{workspaceId: string; recordId: string; userId: string; sourceType: string; sourceId: string; label: string; path: string}> = [];
 const add = (userId: string, sourceType: string, sourceId: string, label: string, path: string) => rows.push({ workspaceId, recordId, userId, sourceType, sourceId, label, path });
 for (const m of members) {
  add(m.userId, "ROLE", m.id, `${m.user.name ?? "Former member"}: ${m.role} · ${m.status}`, "/settings/members");
  const ownTeams = teams.filter(t => t.userId === m.userId);
  for (const t of ownTeams) add(m.userId, "TEAM", t.teamId, `${t.team.name}: ${t.role}`, `/teams/${t.team.id}`);
  for (const g of grants.filter(g => (g.principalType === "USER" && g.principalId === m.userId) || (g.principalType === "ROLE" && g.principalId === m.role) || (g.principalType === "TEAM" && ownTeams.some(t => t.team.id === g.principalId)))) add(m.userId, "VAULT", g.id, `Vault ${g.permission.toLowerCase()} grant (${g.principalType.toLowerCase()})`, "/vault");
  for (const i of integrations.filter(i => i.connectedById === m.userId)) add(m.userId, "INTEGRATION", i.id, `${i.provider}: ${i.accountLabel}`, "/settings/integrations");
  for (const a of socialAccounts.filter(a => a.connectedById === m.userId)) add(m.userId, "SOCIAL_ACCOUNT", a.id, `${a.platform}: ${a.displayName}`, "/settings/social");
  for (const t of tokens.filter(t => t.createdById === m.userId)) add(m.userId, "API_TOKEN", t.id, t.name, "/settings/api-tokens");
  for (const l of licences.filter(l => (object(l.details).assigneeIds as string[] | undefined)?.includes(m.userId))) add(m.userId, "LICENCE", l.id, l.title, `/it?tool=LICENCE&edit=${l.id}`);
 }
 for (const a of socialAccounts.filter(a => !a.connectedById || !members.some(m => m.userId === a.connectedById))) add(actor.user.id, "SOCIAL_ACCOUNT", a.id, `${a.platform}: ${a.displayName} (workspace-owned)`, "/settings/social");
 // Workspace-owned connections and tokens also receive an explicit review item.
 for (const i of integrations.filter(i => !i.connectedById || !members.some(m => m.userId === i.connectedById))) add(actor.user.id, "INTEGRATION", i.id, `${i.provider}: ${i.accountLabel} (workspace-owned)`, "/settings/integrations");
 for (const t of tokens.filter(t => !t.createdById || !members.some(m => m.userId === t.createdById))) add(actor.user.id, "API_TOKEN", t.id, `${t.name} (workspace-owned)`, "/settings/api-tokens");
 ensure(rows.length <= 20000, "This review is too large. Ask the operator to review the inventory.");
 if (rows.length) await tx.marketingItReviewItem.createMany({ data: rows, skipDuplicates: true });
}
const decisionSchema = z.object({ recordId: id.min(1), itemId: id.min(1), decision: z.enum(["KEEP", "REVOKE"]), note: z.string().trim().min(1, "Add a review note.").max(2000) });
export async function decideAccess(supplied: Actor, raw: unknown) {
 const v = decisionSchema.parse(raw);
 await prisma.$transaction(async tx => {
  const actor = await lock(supplied, tx); ensure(canManageItAdministration(actor.membership));
  const row = await readRecord(actor, v.recordId, tx); ensure(row.kind === "REVIEW" && !row.completedAt && !row.archivedAt, "Completed reviews stay locked.");
  ensure(await tx.marketingItReviewItem.count({ where: { workspaceId: actor.workspace.id, recordId: row.id, id: v.itemId } }));
  await tx.marketingItReviewItem.updateMany({ where: { workspaceId: actor.workspace.id, recordId: row.id, id: v.itemId }, data: { decision: v.decision, note: v.note, reviewedById: actor.user.id, reviewedAt: new Date() } });
  await audit(actor, tx, row.id, "access_decided");
 });
}
export async function completeReview(supplied: Actor, recordId: string) {
 await prisma.$transaction(async tx => {
  const actor = await lock(supplied, tx); ensure(canManageItAdministration(actor.membership));
  const row = await readRecord(actor, recordId, tx); ensure(row.kind === "REVIEW" && !row.archivedAt);
  if (row.completedAt) return;
  ensure(await tx.marketingItReviewItem.count({ where: { workspaceId: actor.workspace.id, recordId } }), "This review has no access items.");
  ensure(!await tx.marketingItReviewItem.count({ where: { workspaceId: actor.workspace.id, recordId, OR: [{ decision: "PENDING" }, { note: "" }] } }), "Decide every access item and add notes before completing.");
  const changed = await tx.marketingItRecord.update({ where: { workspaceId_id: { workspaceId: actor.workspace.id, id: recordId } }, data: { status: "COMPLETED", completedAt: new Date(), completedById: actor.user.id } });
  await sync(actor, tx, changed, "review_completed");
 });
}
