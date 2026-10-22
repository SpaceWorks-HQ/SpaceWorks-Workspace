import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { prisma, type Tx } from "@/lib/db";
import { changeSecrets, saveEnvironment, takeSnapshot } from "@/lib/secrets/service";
import { requestKeyRotation, runKeyRotation } from "@/lib/secrets/rotation";
import { sealStored } from "@/lib/vault/hierarchy";
import { saveItem } from "@/lib/vault/service";
import { owner, project, proof } from "./secrets-security/fixtures";

/** Probe the real application's locks after its callback, before it commits. */
async function probeLocks(environmentId: string, operation: () => Promise<unknown>, workspaceLocked = true) {
  // A separate client guarantees the FK checks cannot reuse the lock holder's connection.
  const concurrent = new PrismaClient();
  const transaction = prisma.$transaction.bind(prisma);
  let probes = 0;
  const spy = vi.spyOn(prisma, "$transaction").mockImplementation(
    (async (callback: (tx: Tx) => Promise<unknown>, options?: Parameters<typeof prisma.$transaction>[1]) => transaction(async tx => {
      const result = await callback(tx);
      await concurrent.$transaction(async other => {
        // Old FOR UPDATE locks fail deterministically here instead of waiting for
        // Prisma's 60s deadline (or leaving the insert running after a test timeout).
        await other.$executeRaw`SET LOCAL lock_timeout = '1s'`;
        await other.auditEvent.create({
          data: { workspaceId: owner.workspace.id, action: "test.concurrent_insert" },
        });
        await other.secretFolder.create({
          data: { workspaceId: owner.workspace.id, environmentId, path: `/probe-${randomUUID()}` },
        });
      });
      // The weaker lock must still exclude competing key writers and rotations.
      await expect(concurrent.$transaction(other => workspaceLocked ? other.$queryRaw`
          SELECT "id" FROM "Workspace" WHERE "id"=${owner.workspace.id}
          FOR NO KEY UPDATE NOWAIT
        ` : other.$queryRaw`
          SELECT "id" FROM "SecretEnvironment"
          WHERE "workspaceId"=${owner.workspace.id} AND "id"=${environmentId}
          FOR NO KEY UPDATE NOWAIT
        `)).rejects.toMatchObject({ code: "P2010", meta: { code: "55P03" } });
      probes++;
      return result;
    }, options)) as typeof prisma.$transaction,
  );
  try {
    await operation();
    expect(probes).toBeGreaterThan(0);
  } finally {
    spy.mockRestore();
    await concurrent.$disconnect();
  }
}

describe.sequential("secrets key-write locks", () => {
  it.each([false, true])("allows concurrent FK inserts during a change (protected: %s)", async protectedEnvironment => {
    const p = await project();
    const env = protectedEnvironment ? p.production : p.dev;
    await probeLocks(env.id, () => changeSecrets(owner, env.id, [
      { key: "LOCK_PROBE", path: "/", value: "fixture" },
    ]));
  });

  it("allows concurrent FK inserts during snapshots and standalone encryption", async () => {
    const p = await project();
    await probeLocks(p.dev.id, () => takeSnapshot(owner, p.dev.id, "Lock probe"));
    await probeLocks(p.dev.id, () => sealStored(owner.workspace.id, p.id, "test", "fixture"));
  });

  it("allows concurrent FK inserts during environment edits", async () => {
    const p = await project();
    await probeLocks(p.dev.id, () => saveEnvironment(owner, { ...p.dev, name: "Renamed" }), false);
  });

  it("allows concurrent FK inserts during vault writes using the same key hierarchy", async () => {
    const p = await project();
    await probeLocks(p.dev.id, () => saveItem(owner, {
      title: "Lock probe", type: "SECRET_NOTE", secret: "fixture",
    }));
  });

  it("allows concurrent FK inserts during rotation requests and batches", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [{ key: "ROTATE", path: "/", value: "fixture" }]);
    const actor = { ...owner, proof: await proof(owner) };
    let id = "";
    await probeLocks(p.dev.id, async () => {
      id = (await requestKeyRotation(actor, p.id, "project")).id;
    });
    // Initialise the hierarchy, then re-encrypt a record, in separate transactions.
    await probeLocks(p.dev.id, () => runKeyRotation(id, 1, 1));
    await probeLocks(p.dev.id, () => runKeyRotation(id, 1, 1));
  });
});
