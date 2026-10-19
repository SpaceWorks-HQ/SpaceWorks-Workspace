import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isAdmin, type OpsActor } from "@/lib/approvals/context";
import { guard, parse, id, title, minor, currency, optionalId, optionalDate, webUrl, memberRef, teamRef, note, searchable, OpsError } from "@/lib/approvals/ops";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { canViewCosts } from "@/lib/roles";
import { permitted } from "@/lib/vault/service";
import { worstStatus, cloudStatus } from "./status";

export async function listCatalogue(actor: OpsActor) {
 await guard(actor);
 const rows = await prisma.serviceCatalogItem.findMany({ where: { workspaceId: actor.workspace.id, ...teamScopeFilter(await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role })) }, include: { links: true }, orderBy: { name: "asc" }, take: 500 });
 return Promise.all(rows.map(async row => {
  const monitors = (await prisma.monitor.findMany({ where: { workspaceId: actor.workspace.id, id: { in: row.links.filter(l => l.targetType === "MONITOR").map(l => l.targetId) } }, select: { id: true, name: true, lastStatus: true } })).map((m) => ({ id: m.id, name: m.name, status: m.lastStatus }));
  const resources = await prisma.cloudResource.findMany({ where: { workspaceId: actor.workspace.id, id: { in: row.links.filter(l => l.targetType === "CLOUD_RESOURCE").map(l => l.targetId) } }, select: { id: true, name: true, status: true } });
  const vaultItems = [];
  for (const link of row.links.filter(l => l.targetType === "VAULT_ITEM")) { const item = await prisma.vaultItem.findFirst({ where: { id: link.targetId, workspaceId: actor.workspace.id, deletedAt: null }, select: { id: true, workspaceId: true, title: true, ownerId: true, collectionId: true } }); if (item && await permitted(actor, item, "LIST")) vaultItems.push({ id: item.id, title: item.title }); }
  const runbook = row.runbookDocId ? await prisma.doc.findFirst({ where: { id: row.runbookDocId, workspaceId: actor.workspace.id, archivedAt: null, ...(!isAdmin(actor) ? { visibility: "WORKSPACE" } : {}) }, select: { id: true, title: true } }) : null;
  const costs = canViewCosts(actor.membership, { costsVisibleToMembers: !!actor.workspace.costsVisibleToMembers });
  return { ...row, links: undefined, runbookDocId: runbook?.id ?? null, costMinor: costs ? row.costMinor : null, costCurrency: costs ? row.costCurrency : null, monitors, resources, vaultItems, runbook, status: worstStatus([...monitors.map(m => m.status), ...resources.map(r => cloudStatus(r.status))]) };
 }));
}
export async function saveService(actor: OpsActor, input: unknown) {
 await guard(actor);
 const v = parse(z.object({ id: optionalId, name: title, slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(100), kind: z.enum(["INTERNAL_APP", "WEBSITE", "SAAS_ACCOUNT", "DOMAIN", "SERVER", "DATABASE", "STORAGE", "REPO", "BOT", "DEVICE", "OTHER"]), url: webUrl, description: z.string().trim().max(2000).optional(), ownerId: optionalId, teamId: optionalId, environment: z.enum(["PROD", "STAGING", "DEV", "NONE"]), criticality: z.enum(["TIER1", "TIER2", "TIER3"]), lifecycle: z.enum(["PLANNED", "ACTIVE", "DEPRECATED", "RETIRED"]).default("ACTIVE"), runbookDocId: optionalId, renewalAt: optionalDate, costMinor: minor.optional(), costCurrency: currency, costPeriod: z.enum(["MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME", "USAGE"]).optional(), monitorIds: z.array(id).max(30).default([]), cloudResourceIds: z.array(id).max(30).default([]), vaultItemIds: z.array(id).max(30).default([]) }), input);
 await teamRef(actor, v.teamId); await memberRef(actor, v.ownerId);
 if (!isAdmin(actor)) {
  if (!v.teamId || !await prisma.teamMember.findFirst({ where: { teamId: v.teamId, userId: actor.user.id, role: "LEAD", team: { workspaceId: actor.workspace.id, archivedAt: null } } })) throw new OpsError("Only admins or the owning team's leads can edit this service.");
  if (v.id) { const current = await prisma.serviceCatalogItem.findFirst({ where: { id: v.id, workspaceId: actor.workspace.id, teamId: v.teamId } }); if (!current) throw new OpsError("That service is unavailable."); }
  if (v.costMinor !== undefined || v.costPeriod !== undefined) throw new OpsError("Ask an admin to update billing details.");
 }
 if (v.runbookDocId && !await prisma.doc.findFirst({ where: { id: v.runbookDocId, workspaceId: actor.workspace.id, archivedAt: null, ...(!isAdmin(actor) ? { visibility: "WORKSPACE" } : {}) } })) throw new OpsError("Choose a runbook you can read.");
 if (await prisma.monitor.count({ where: { workspaceId: actor.workspace.id, id: { in: v.monitorIds } } }) !== new Set(v.monitorIds).size || await prisma.cloudResource.count({ where: { workspaceId: actor.workspace.id, id: { in: v.cloudResourceIds } } }) !== new Set(v.cloudResourceIds).size) throw new OpsError("Choose checks and cloud resources in this workspace.");
 for (const itemId of v.vaultItemIds) { const item = await prisma.vaultItem.findFirst({ where: { id: itemId, workspaceId: actor.workspace.id, deletedAt: null } }); if (!item || !await permitted(actor, item, "LIST")) throw new OpsError("Choose vault items you can access."); }
 return prisma.$transaction(async tx => {
  const { id: rowId, monitorIds, cloudResourceIds, vaultItemIds, url, costCurrency, ...data } = v;
  const payload = { ...data, ...(isAdmin(actor) ? { costCurrency } : {}), urls: url ? [url] : [] };
  const row = rowId ? await tx.serviceCatalogItem.update({ where: { id: rowId, workspaceId: actor.workspace.id }, data: payload }) : await tx.serviceCatalogItem.create({ data: { ...payload, workspaceId: actor.workspace.id, createdById: actor.user.id } });
  await tx.serviceLink.deleteMany({ where: { serviceId: row.id, service: { workspaceId: actor.workspace.id }, targetType: { in: ["MONITOR", "CLOUD_RESOURCE", "VAULT_ITEM"] } } });
  const links = [...monitorIds.map(targetId => ({ targetId, targetType: "MONITOR" as const })), ...cloudResourceIds.map(targetId => ({ targetId, targetType: "CLOUD_RESOURCE" as const })), ...vaultItemIds.map(targetId => ({ targetId, targetType: "VAULT_ITEM" as const }))];
  if (links.length) await tx.serviceLink.createMany({ data: links.map(l => ({ ...l, serviceId: row.id })), skipDuplicates: true });
  await note(actor, "catalogue", row.id, "saved", tx); await searchable(actor, "service", row.id, row.name, "catalogue", row.teamId, tx); return row.id;
 });
}
