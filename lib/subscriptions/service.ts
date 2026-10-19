import "server-only";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { OpsActor } from "@/lib/approvals/context";
import { guard, parse, id, title, minor, currency, optionalId, optionalDate, note, memberRef, teamRef, OpsError } from "@/lib/approvals/ops";
import { hiddenTeamIds, teamScopeFilter } from "@/lib/teamAccess";
import { canViewCosts } from "@/lib/roles";
import { setScopedDestinations } from "@/lib/notify/scopedRules";
import { permitted } from "@/lib/vault/service";

export async function listSubscriptions(actor: OpsActor) {
 await guard(actor);
 const rows = await prisma.subscription.findMany({ where: { workspaceId: actor.workspace.id, ...teamScopeFilter(await hiddenTeamIds(actor.workspace.id, { userId: actor.user.id, role: actor.membership.role })) }, orderBy: { nextRenewalAt: "asc" }, take: 500 });
 const showCosts = canViewCosts(actor.membership, { costsVisibleToMembers: !!actor.workspace.costsVisibleToMembers });
 return rows.map(r => ({ ...r, amountMinor: showCosts ? r.amountMinor : null, paymentMethodLabel: showCosts ? r.paymentMethodLabel : null, payer: showCosts ? r.payer : null, notes: showCosts ? r.notes : null, contractFileId: showCosts ? r.contractFileId : null }));
}
export async function saveSubscription(actor: OpsActor, input: unknown) {
 await guard(actor, true);
 const v = parse(z.object({ id: optionalId, name: title, kind: z.enum(["DOMAIN", "SAAS", "HOSTING", "INSURANCE", "LICENSE", "LEASE", "MEMBERSHIP", "OTHER"]).default("SAAS"), amountMinor: minor, currency, period: z.enum(["MONTHLY", "QUARTERLY", "YEARLY", "ONE_TIME", "USAGE"]), nextRenewalAt: optionalDate, ownerId: optionalId, teamId: optionalId, serviceId: optionalId, vaultItemId: optionalId, autoRenew: z.boolean().default(true), reminderOffsets: z.array(z.coerce.number().int().min(0).max(365)).max(10).default([30, 7, 1]), status: z.enum(["ACTIVE", "CANCELLING", "CANCELLED", "EXPIRED"]).default("ACTIVE"), destinationIds: z.array(id).max(20).optional() }), input);
 await memberRef(actor, v.ownerId); await teamRef(actor, v.teamId);
 if (v.serviceId && !await prisma.serviceCatalogItem.findFirst({ where: { id: v.serviceId, workspaceId: actor.workspace.id } })) throw new OpsError("Choose a service in this workspace.");
 if (v.vaultItemId) { const item = await prisma.vaultItem.findFirst({ where: { id: v.vaultItemId, workspaceId: actor.workspace.id, deletedAt: null } }); if (!item || !await permitted(actor, item, "LIST")) throw new OpsError("Choose a vault item you can access."); }
 return prisma.$transaction(async tx => {
  const { id: rowId, destinationIds, ...data } = v;
  const row = rowId ? await tx.subscription.update({ where: { id: rowId, workspaceId: actor.workspace.id }, data }) : await tx.subscription.create({ data: { ...data, workspaceId: actor.workspace.id, createdById: actor.user.id } });
  if (destinationIds) await setScopedDestinations(tx, { workspaceId: actor.workspace.id, scopeType: "SUBSCRIPTION", scopeId: row.id, destinationIds, actorId: actor.user.id });
  await note(actor, "subscription", row.id, "saved", tx); return row.id;
 });
}
