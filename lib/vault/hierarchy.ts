import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { VaultKey } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { encryptWithKey, decryptWithKey, vaultRootKeys, sha256Hex, openLegacyVaultEnvelope } from "@/lib/crypto";
// Future external providers implement wrapping here; plaintext keys stay inside this server module.
export interface InternalKeyProvider { wrap(key: Buffer, parent: Buffer, binding: string): string; unwrap(ciphertext: string, parent: Buffer, binding: string): Buffer }
const internal: InternalKeyProvider = {
  wrap: (key, parent, binding) => encryptWithKey(parent, key.toString("base64"), binding),
  unwrap: (ciphertext, parent, binding) => Buffer.from(decryptWithKey(parent, ciphertext, binding), "base64"),
};
const keyBinding = (row: Pick<VaultKey, "workspaceId" | "scope" | "version">) => JSON.stringify(["sww-key-v2", row.workspaceId, row.scope, row.version]);
// Weakly held transaction contexts never cache active keys on the process-wide Prisma client.
const transactionContexts = new WeakMap<object, { material: Map<string, Buffer>; records: Map<string, VaultKey>; active: Map<string, VaultKey>; locked: Set<string> }>();
function context(client: DbClient) {
  if (client === prisma) return null;
  let value = transactionContexts.get(client);
  if (!value) { value = { material: new Map(), records: new Map(), active: new Map(), locked: new Set() }; transactionContexts.set(client, value); }
  return value;
}
async function lockWorkspace(workspaceId: string, client: DbClient) {
  const cache = context(client)?.locked; if (cache?.has(workspaceId)) return;
  // Serialise key writes without blocking foreign-key inserts in other connections.
  // Never upgrade this to FOR UPDATE: every tenant row references Workspace.
  await client.$queryRaw`SELECT "id" FROM "Workspace" WHERE "id"=${workspaceId} FOR NO KEY UPDATE`;
  cache?.add(workspaceId);
}
async function keyRecord(workspaceId: string, id: string, client: DbClient) {
  const cache = context(client)?.records, cacheId = workspaceId + ":" + id;
  const found = cache?.get(cacheId);
  if (found) return found;
  const row = await client.vaultKey.findFirstOrThrow({ where: { workspaceId, id } });
  cache?.set(cacheId, row); return row;
}
async function unwrap(row: VaultKey, client: DbClient): Promise<Buffer> {
  const cache = context(client)?.material, cacheId = row.workspaceId + ":" + row.id;
  const found = cache?.get(cacheId); if (found) return found;
  let key: Buffer;
  if (row.parentId) {
    const parent = await keyRecord(row.workspaceId, row.parentId, client);
    key = internal.unwrap(row.wrappedKey, await unwrap(parent, client), keyBinding(row));
  } else {
    const root = vaultRootKeys().find(k => k.version === row.rootVersion);
    if (!root) throw new Error("A vault root key version is unavailable.");
    key = internal.unwrap(row.wrappedKey, root.key, keyBinding(row));
  }
  cache?.set(cacheId, key); return key;
}
async function createKey(workspaceId: string, scope: string, projectId: string | null, client: DbClient, parent?: VaultKey) {
  const latest = await client.vaultKey.findFirst({ where: { workspaceId, scope }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1, key = randomBytes(32), root = vaultRootKeys()[0];
  const wrappingKey = parent ? await unwrap(parent, client) : root.key;
  return client.vaultKey.create({ data: { workspaceId, scope, projectId, version, fingerprint: sha256Hex(key.toString("base64")).slice(0, 24), parentId: parent?.id, rootVersion: parent ? null : root.version, wrappedKey: internal.wrap(key, wrappingKey, keyBinding({ workspaceId, scope, version })) } });
}
async function activeKey(workspaceId: string, projectId: string | null, client: DbClient): Promise<VaultKey> {
  const scope = projectId ? "project:" + projectId : "vault";
  const cache = context(client)?.active, cacheId = workspaceId + ":" + scope;
  const cached = cache?.get(cacheId); if (cached) return cached;
  const existing = await client.vaultKey.findFirst({ where: { workspaceId, scope, active: true }, orderBy: { version: "desc" } });
  if (existing) { cache?.set(cacheId, existing); return existing; }
  // Workspace row lock serialises first-key creation with rotations and writes.
  await lockWorkspace(workspaceId, client);
  const repeated = await client.vaultKey.findFirst({ where: { workspaceId, scope, active: true }, orderBy: { version: "desc" } });
  if (repeated) { cache?.set(cacheId, repeated); return repeated; }
  let workspaceKey = await client.vaultKey.findFirst({ where: { workspaceId, scope: "workspace", active: true }, orderBy: { version: "desc" } });
  workspaceKey ??= await createKey(workspaceId, "workspace", null, client);
  const created = await createKey(workspaceId, scope, projectId, client, workspaceKey);
  cache?.set(cacheId, created); return created;
}
export async function sealStored(workspaceId: string, projectId: string | null, binding: string, plaintext: string, client: DbClient = prisma): Promise<{ secretEnc: string; dataKeyEnc: string }> {
  if (client === prisma) return prisma.$transaction(tx => sealStored(workspaceId, projectId, binding, plaintext, tx));
  await lockWorkspace(workspaceId, client);
  const row = await activeKey(workspaceId, projectId, client);
  return { secretEnc: encryptWithKey(await unwrap(row, client), plaintext, JSON.stringify(["sww-value-v2", workspaceId, projectId, binding])), dataKeyEnc: "h2:" + row.id };
}
export async function openStored(workspaceId: string, projectId: string | null, binding: string, sealed: { secretEnc: string; dataKeyEnc: string }, client: DbClient = prisma): Promise<string> {
  if (!sealed.dataKeyEnc.startsWith("h2:")) return openLegacyVaultEnvelope(sealed);
  const row = await keyRecord(workspaceId, sealed.dataKeyEnc.slice(3), client);
  if (row.projectId !== projectId) throw new Error("Invalid project data key.");
  return decryptWithKey(await unwrap(row, client), sealed.secretEnc, JSON.stringify(["sww-value-v2", workspaceId, projectId, binding]));
}
export async function rotateHierarchyKey(workspaceId: string, projectId: string, kind: string, client: DbClient) {
  await lockWorkspace(workspaceId, client);
  const current = await activeKey(workspaceId, projectId, client);
  if (kind === "workspace") {
    const parent = await createKey(workspaceId, "workspace", null, client);
    const children = await client.vaultKey.findMany({ where: { workspaceId, parentId: { not: null } } });
    for (const child of children) {
      const key = await unwrap(child, client);
      await client.vaultKey.update({ where: { workspaceId_scope_version: { workspaceId, scope: child.scope, version: child.version } }, data: { wrappedKey: internal.wrap(key, await unwrap(parent, client), keyBinding(child)), parentId: parent.id } });
    }
    await client.vaultKey.updateMany({ where: { workspaceId, scope: "workspace", id: { not: parent.id }, active: true }, data: { active: false, retiredAt: new Date() } });
  } else {
    const parent = await client.vaultKey.findFirstOrThrow({ where: { workspaceId, scope: "workspace", active: true }, orderBy: { version: "desc" } });
    await createKey(workspaceId, current.scope, projectId, client, parent);
    await client.vaultKey.updateMany({ where: { workspaceId, scope: current.scope, version: { lte: current.version }, active: true }, data: { active: false, retiredAt: new Date() } });
  }
  transactionContexts.delete(client);
}
export async function encryptionSummary(workspaceId: string, projectId: string, client: DbClient = prisma): Promise<NonNullable<import("@/lib/secrets/types").SecretsView["encryption"]>> {
  if (client === prisma) return prisma.$transaction(tx => encryptionSummary(workspaceId, projectId, tx));
  const key = await activeKey(workspaceId, projectId, client);
  const parent = await client.vaultKey.findFirstOrThrow({ where: { workspaceId, id: key.parentId! } });
  const lastJob = await client.secretKeyRotation.findFirst({ where: { workspaceId, projectId }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, status: true, processed: true, total: true, createdAt: true, finishedAt: true } });
  return { algorithm: "AES-256-GCM", rootVersion: parent.rootVersion!, workspaceVersion: parent.version, workspaceFingerprint: parent.fingerprint, projectVersion: key.version, projectFingerprint: key.fingerprint, createdAt: key.createdAt, workspaceCreatedAt: parent.createdAt, lastJob };
}
export function vaultBinding(id: string = randomUUID()) { return "vault-item:" + id; }
