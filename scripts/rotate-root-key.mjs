/** Run with both the new and previous root versions in VAULT_MASTER_KEYS. Never prints keys. */
import { PrismaClient } from "@prisma/client";
import { vaultRootKeys, decryptWithKey, encryptWithKey } from "./vault-root-crypto.mjs";
let prisma;
try {
  prisma = new PrismaClient({ datasourceUrl: process.env.DIRECT_URL || process.env.DATABASE_URL });
  const roots = vaultRootKeys(), newest = roots[0];
  const lock = await prisma.$queryRaw`SELECT pg_try_advisory_lock(hashtext('sww-root-key-rotation')) AS locked`;
  if (!lock[0]?.locked) throw new Error("A root rotation is already running.");
  for (;;) {
    const changed = await prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw`SELECT * FROM "VaultKey" WHERE "parentId" IS NULL AND "rootVersion" <> ${newest.version} ORDER BY "id" LIMIT 20 FOR UPDATE SKIP LOCKED`;
      for (const row of rows) {
        const old = roots.find(root => root.version === row.rootVersion);
        if (!old) throw new Error("A previous root key is required. Keep all old versions during rotation.");
        const binding = JSON.stringify(["sww-key-v2", row.workspaceId, row.scope, row.version]);
        const material = decryptWithKey(old.key, row.wrappedKey, binding);
        await tx.vaultKey.update({ where: { workspaceId_scope_version: { workspaceId: row.workspaceId, scope: row.scope, version: row.version } }, data: { wrappedKey: encryptWithKey(newest.key, material, binding), rootVersion: newest.version } });
      }
      return rows.length;
    });
    if (!changed) break;
    process.stdout.write(`Re-wrapped ${changed} workspace key versions.\n`);
  }
  const remaining = await prisma.vaultKey.count({ where: { parentId: null, rootVersion: { not: newest.version } } });
  if (remaining) throw new Error("Some workspace keys are busy. Rerun to resume.");
  const legacy = await prisma.applicationSecret.count({ where: { NOT: { dataKeyEnc: { startsWith: "h2:" } } } }) + await prisma.applicationSecretVersion.count({ where: { NOT: { dataKeyEnc: { startsWith: "h2:" } } } }) + await prisma.secretSnapshot.count({ where: { NOT: { dataKeyEnc: { startsWith: "h2:" } } } }) + await prisma.secretChange.count({ where: { NOT: { dataKeyEnc: { startsWith: "h2:" } } } }) + await prisma.vaultItem.count({ where: { NOT: { dataKeyEnc: { startsWith: "h2:" } } } }) + await prisma.vaultItemVersion.count({ where: { NOT: { dataKeyEnc: { startsWith: "h2:" } } } });
  process.stdout.write(legacy ? "Wrapped keys updated. Legacy records remain: retain previous roots and run project/workspace rotations before retiring them.\n" : "All workspace keys use the newest root version. Retain previous roots with protected historical backups.\n");
} catch {
  process.stderr.write("Root rotation could not finish. Check key versions and database access; rerun to resume.\n"); process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
