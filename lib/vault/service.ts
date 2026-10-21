import "server-only";
import { z } from "zod";
import type { VaultItem, VaultPermission } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { sealStored, openStored, vaultBinding } from "./hierarchy";
import { isAdmin, type OpsActor } from "@/lib/approvals/context";
import { guard, parse, id, title, optionalId, webUrl, note, OpsError, memberRef, teamRef } from "@/lib/approvals/ops";
import { hasVaultMfa } from "./mfa";
import { requestApproval } from "@/lib/approvals/engine";
import { dispatch } from "@/lib/notify/dispatch";
import { hasRoleAtLeast } from "@/lib/roles";

const rank: Record<VaultPermission, number> = { LIST: 0, REVEAL: 1, EDIT: 2, MANAGE: 3 };
export async function permitted(actor: OpsActor, item: Pick<VaultItem, "id" | "workspaceId" | "collectionId" | "ownerId">, permission: VaultPermission, client: DbClient = prisma, now = new Date()) {
 if (item.workspaceId !== actor.workspace.id || actor.membership.role === "GUEST") return false;
 if (item.ownerId === actor.user.id || isAdmin(actor)) return true;
 const teams = await client.teamMember.findMany({ where: { userId: actor.user.id, team: { workspaceId: actor.workspace.id, archivedAt: null } }, select: { teamId: true } });
 const grants = await client.vaultGrant.findMany({ where: { workspaceId: actor.workspace.id, OR: [{ itemId: item.id }, ...(item.collectionId ? [{ collectionId: item.collectionId, itemId: null }] : [])], AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }] } });
 return grants.some(g => rank[g.permission] >= rank[permission] && (g.principalType === "USER" ? g.principalId === actor.user.id : g.principalType === "TEAM" ? teams.some(t => t.teamId === g.principalId) : ["OWNER", "ADMIN", "MEMBER"].includes(g.principalId) && hasRoleAtLeast(actor.membership.role, g.principalId as "OWNER" | "ADMIN" | "MEMBER")));
}
export async function listVault(actor: OpsActor) {
 await guard(actor);
 const rows = await prisma.vaultItem.findMany({ where: { workspaceId: actor.workspace.id, deletedAt: null }, select: { id: true, workspaceId: true, collectionId: true, ownerId: true, title: true, type: true, username: true, url: true, sensitivity: true, rotateEveryDays: true, lastRotatedAt: true }, orderBy: { title: "asc" }, take: 1000 });
 const visible = [];
 for (const row of rows) if (await permitted(actor, row, "LIST")) visible.push({ ...row, canReveal: await permitted(actor, row, "REVEAL"), canManage: await permitted(actor, row, "MANAGE"), grants: await permitted(actor, row, "MANAGE") ? await prisma.vaultGrant.findMany({ where: { workspaceId: actor.workspace.id, itemId: row.id }, select: { id: true, permission: true, principalType: true, principalId: true, expiresAt: true } }) : [], canEdit: await permitted(actor, row, "EDIT") });
 return visible;
}
const itemSchema = z.object({ id: optionalId, title, collectionId: optionalId, type: z.enum(["LOGIN", "API_KEY", "SECRET_NOTE", "SSH_KEY", "CARD_REFERENCE", "WIFI", "TOTP"]), username: z.string().trim().max(200).optional(), url: webUrl, secret: z.string().min(1).max(20000), sensitivity: z.enum(["NORMAL", "HIGH"]).default("HIGH"), rotateEveryDays: z.preprocess(v => v === "" ? null : v, z.coerce.number().int().min(1).max(3650).nullable().optional()) });
export async function saveItem(actor: OpsActor, input: unknown) {
 await guard(actor); const v = parse(itemSchema, input);
 // Card references accept only four digits; no PAN, CVV or expiry ever enters storage.
 if (v.type === "CARD_REFERENCE" && !/^\d{4}$/.test(v.secret)) throw new OpsError("Store only the card's last four digits.");
 if (v.collectionId) {
  const collection = await prisma.vaultCollection.findFirst({ where: { id: v.collectionId, workspaceId: actor.workspace.id } });
  if (!collection || !isAdmin(actor)) throw new OpsError("Only admins can add items to shared collections.");
 }
 const itemId = v.id ?? randomUUID();
 return prisma.$transaction(async tx => {
  await tx.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${actor.workspace.id} FOR UPDATE`;
  if (v.id) {
   await tx.$queryRaw`SELECT "id" FROM "VaultItem" WHERE "id"=${v.id} AND "workspaceId"=${actor.workspace.id} FOR UPDATE`;
   const old = await tx.vaultItem.findFirst({ where: { id: v.id, workspaceId: actor.workspace.id, deletedAt: null } });
   if (!old || !await permitted(actor, old, "EDIT", tx)) throw new OpsError("That item is unavailable.");
   await tx.vaultItemVersion.create({ data: { itemId: old.id, secretEnc: old.secretEnc, dataKeyEnc: old.dataKeyEnc, keyVersion: old.keyVersion, createdById: actor.user.id } });
   const versions = await tx.vaultItemVersion.findMany({ where: { itemId: old.id, item: { workspaceId: actor.workspace.id } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: 5, select: { id: true } });
   await tx.vaultItemVersion.deleteMany({ where: { id: { in: versions.map(v => v.id) }, item: { workspaceId: actor.workspace.id } } });
  }
  const sealed = await sealStored(actor.workspace.id, null, vaultBinding(itemId), v.secret, tx);
  const data = { title: v.title, collectionId: v.collectionId, type: v.type, username: v.type === "LOGIN" ? v.username : null, url: v.url, sensitivity: v.sensitivity, rotateEveryDays: v.rotateEveryDays, lastRotatedAt: new Date(), ...sealed };
  const row = v.id ? await tx.vaultItem.update({ where: { id: v.id, workspaceId: actor.workspace.id }, data }) : await tx.vaultItem.create({ data: { ...data, id: itemId, workspaceId: actor.workspace.id, ownerId: actor.user.id } });
  await tx.vaultAccessLog.create({ data: { workspaceId: actor.workspace.id, itemId: row.id, userId: actor.user.id, action: v.id ? "ROTATE" : "EDIT" } });
  await note(actor, "vault", row.id, v.id ? "rotated" : "created", tx); return row.id;
 });
}
export async function revealItem(actor: OpsActor, itemId: string, proof?: string, action: "REVEAL" | "COPY" = "REVEAL", now = new Date()) {
 await guard(actor); parse(id, itemId);
 const result = await prisma.$transaction(async tx => {
  const item = await tx.vaultItem.findFirst({ where: { id: itemId, workspaceId: actor.workspace.id, deletedAt: null } });
  if (!item) return { error: "That item is unavailable." };
  const allowed = await permitted(actor, item, "REVEAL", tx, now);
  const verified = item.sensitivity !== "HIGH" || await hasVaultMfa(actor.user.id, proof, now, tx);
  await tx.vaultAccessLog.create({ data: { workspaceId: actor.workspace.id, itemId, userId: actor.user.id, action: allowed && verified ? action : "DENIED" } });
  await note(actor, "vault", itemId, allowed && verified ? (action === "COPY" ? "item_copied" : "item_revealed") : "reveal_denied", tx);
  if (!allowed) return { error: "Request access before revealing this item." };
  if (!verified) return { error: "Verify a fresh two-step code to reveal this item." };
  // Decrypt after authorization; no plaintext goes into event or audit metadata.
  const secret = await openStored(actor.workspace.id, null, vaultBinding(item.id), item, tx);
  const event = await dispatch(actor.workspace.id, { type: "vault.item_revealed", title: "A vault item was accessed", actorId: actor.user.id, resource: { type: "vault_item", id: itemId }, data: { itemId, byUserId: actor.user.id } }, { tx });
  return { secret, afterCommit: event.afterCommit };
 });
 if ("error" in result) throw new OpsError(result.error);
 await result.afterCommit(); return result.secret;
}
export async function createCollection(actor: OpsActor, input: unknown) {
 await guard(actor, true); const v = parse(z.object({ name: title }), input);
 const row = await prisma.vaultCollection.create({ data: { ...v, workspaceId: actor.workspace.id, createdById: actor.user.id } }); await note(actor, "vault", row.id, "collection_created"); return row.id;
}
export async function grantAccess(actor: OpsActor, input: unknown) {
 await guard(actor);
 const v = parse(z.object({ itemId: optionalId, collectionId: optionalId, principalType: z.enum(["USER", "TEAM", "ROLE"]), principalId: id, permission: z.enum(["LIST", "REVEAL", "EDIT", "MANAGE"]), durationHours: z.coerce.number().int().min(1).max(8760).default(24) }).refine(v => !!v.itemId !== !!v.collectionId, "Choose an item or a collection."), input);
 if (v.principalType === "USER") await memberRef(actor, v.principalId);
 if (v.principalType === "TEAM") await teamRef(actor, v.principalId);
 if (v.principalType === "ROLE" && !["MEMBER", "ADMIN", "OWNER"].includes(v.principalId)) throw new OpsError("Choose a member role.");
 if (v.collectionId && (!isAdmin(actor) || !await prisma.vaultCollection.findFirst({ where: { id: v.collectionId, workspaceId: actor.workspace.id } }))) throw new OpsError("That collection is unavailable.");
 if (v.itemId) {
  const item = await prisma.vaultItem.findFirst({ where: { id: v.itemId, workspaceId: actor.workspace.id, deletedAt: null } });
  if (!item || !await permitted(actor, item, "MANAGE")) throw new OpsError("You can't manage access to this item.");
 }
 return prisma.$transaction(async tx => {
 const row = await tx.vaultGrant.create({ data: { itemId: v.itemId, collectionId: v.collectionId, principalId: v.principalId, principalType: v.principalType, permission: v.permission, workspaceId: actor.workspace.id, expiresAt: new Date(Date.now() + v.durationHours * 3600000), grantedById: actor.user.id } });
 if (v.itemId) await tx.vaultAccessLog.create({ data: { workspaceId: actor.workspace.id, itemId: v.itemId, userId: actor.user.id, action: "GRANT" } });
 await note(actor, "vault", row.id, "granted", tx); return row.id;
 });
}
export async function revokeGrant(actor: OpsActor, grantId: string) {
 await guard(actor); parse(id, grantId);
 await prisma.$transaction(async tx => {
  const grant = await tx.vaultGrant.findFirst({ where: { id: grantId, workspaceId: actor.workspace.id } });
  if (!grant) throw new OpsError("That grant is unavailable.");
  const item = grant.itemId ? await tx.vaultItem.findFirst({ where: { id: grant.itemId, workspaceId: actor.workspace.id, deletedAt: null } }) : null;
  if (!isAdmin(actor) && (!item || !await permitted(actor, item, "MANAGE", tx))) throw new OpsError("You can't manage this grant.");
  await tx.vaultGrant.deleteMany({ where: { id: grantId, workspaceId: actor.workspace.id } });
  if (item) await tx.vaultAccessLog.create({ data: { workspaceId: actor.workspace.id, itemId: item.id, userId: actor.user.id, action: "GRANT", reason: "Grant revoked" } });
  await note(actor, "vault", grantId, "grant_revoked", tx);
 });
}
export async function deleteItem(actor: OpsActor, itemId: string) {
 await guard(actor); parse(id, itemId);
 await prisma.$transaction(async tx => {
  const item = await tx.vaultItem.findFirst({ where: { id: itemId, workspaceId: actor.workspace.id, deletedAt: null } });
  if (!item || !await permitted(actor, item, "MANAGE", tx)) throw new OpsError("That item is unavailable.");
  await tx.vaultItem.updateMany({ where: { id: itemId, workspaceId: actor.workspace.id }, data: { deletedAt: new Date() } });
  await tx.vaultGrant.deleteMany({ where: { itemId, workspaceId: actor.workspace.id } });
  await tx.vaultAccessLog.create({ data: { workspaceId: actor.workspace.id, itemId, userId: actor.user.id, action: "EDIT", reason: "Item archived" } });
  await note(actor, "vault", itemId, "archived", tx);
 });
}
export async function requestAccess(actor: OpsActor, input: unknown) {
 await guard(actor); const v = parse(z.object({ itemId: id, reason: z.string().trim().min(1).max(1000), durationHours: z.coerce.number().int().min(1).max(168).default(24) }), input);
 const item = await prisma.vaultItem.findFirst({ where: { id: v.itemId, workspaceId: actor.workspace.id, deletedAt: null } });
 if (!item || !await permitted(actor, item, "LIST")) throw new OpsError("That item is unavailable.");
 const result = await prisma.$transaction(async tx => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`vault-access:${item.id}:${actor.user.id}`}))`;
  if (await tx.vaultAccessRequest.findFirst({ where: { workspaceId: actor.workspace.id, itemId: item.id, requesterId: actor.user.id, status: "PENDING" } })) throw new OpsError("An access request is already pending.");
  const row = await tx.vaultAccessRequest.create({ data: { ...v, requesterId: actor.user.id, workspaceId: actor.workspace.id } });
  const approval = await requestApproval(tx, { workspace: actor.workspace, subjectType: "VAULT_ACCESS", subjectId: row.id, title: "Vault access", requesterId: actor.user.id, steps: [{ approverType: "USER", ref: item.ownerId, minApprovals: 1 }], notifyApprovers: false });
  const event = await dispatch(actor.workspace.id, { type: "vault.access.requested", title: "Vault access needs approval", actorId: actor.user.id, recipients: approval.approverIds, url: `/w/${actor.workspace.slug}/requests/approvals`, data: { accessRequestId: row.id, itemId: item.id } }, { tx });
  return event.afterCommit;
 }); await result();
}
