import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "@/tests/helpers/fixtures";
import {
  createProject,
  saveGrant,
  saveEnvironment,
  changeSecrets,
  readSecrets,
  previewImport,
  importSecrets,
  takeSnapshot,
  rollbackSnapshot,
  snapshotDiff,
  secretHistory,
  restoreVersion,
  revealVersion,
} from "@/lib/secrets/service";
import { environmentAccess, type SecretsActor } from "@/lib/secrets/access";
import {
  createServiceToken,
  authenticateServiceToken,
  revokeServiceToken,
  ipAllowed,
} from "@/lib/secrets/tokens";
import {
  issueDeviceCode,
  approveDeviceCode,
  pollDeviceCode,
  authenticateCliToken,
  refreshCliToken,
  revokeCliSession,
} from "@/lib/secrets/device";
import { createShare, consumeShare } from "@/lib/secrets/shares";
import { loadSecrets } from "@/lib/secrets/queries";
import { decide } from "@/lib/approvals/engine";
import { hmacHex } from "@/lib/crypto";
import { openValue } from "@/lib/secrets/encryption";
import { searchDocuments } from "@/lib/search/query";
import { run } from "@/lib/scheduled/secrets";
import { GET, POST } from "@/app/api/v1/secrets/route";
const suffix = uniqueSuffix(),
  domain = `${suffix}@secrets.test`,
  slugs = [`secrets-${suffix}`, `secrets-other-${suffix}`];
let owner: SecretsActor,
  admin: SecretsActor,
  member: SecretsActor,
  guest: SecretsActor,
  other: SecretsActor;
let counter = 0;
async function project() {
  const id = await createProject(owner, {
    name: `Project ${++counter}`,
    slug: `project-${counter}`,
  });
  const envs = await prisma.secretEnvironment.findMany({
    where: { workspaceId: owner.workspace.id, projectId: id },
  });
  return {
    id,
    dev: envs.find((e) => e.slug === "dev")!,
    staging: envs.find((e) => e.slug === "staging")!,
    production: envs.find((e) => e.production)!,
  };
}
async function proof(actor: SecretsActor) {
  const now = new Date();
  const user = await prisma.user.update({
    where: { id: actor.user.id },
    data: { mfaEnabledAt: new Date(now.getTime() - 1000) },
  });
  const body = Buffer.from(
    JSON.stringify({
      u: user.id,
      v: user.sessionVersion,
      m: user.mfaEnabledAt!.getTime(),
      at: now.getTime(),
    }),
  ).toString("base64url");
  return body + "." + hmacHex(process.env.AUTH_SECRET!, `vault-step:${body}`);
}
beforeAll(async () => {
  process.env.VAULT_MASTER_KEY = Buffer.alloc(32, 17).toString("base64");
  const o = await createUser("owner-" + domain),
    a = await createUser("admin-" + domain),
    m = await createUser("member-" + domain),
    g = await createUser("guest-" + domain);
  const w = await createWorkspace(slugs[0], o.id),
    w2 = await createWorkspace(slugs[1], o.id);
  await addMember(w.id, a.id, "ADMIN");
  await addMember(w.id, m.id);
  await addMember(w.id, g.id, "GUEST");
  owner = { user: o, workspace: w, membership: { role: "OWNER" } };
  admin = { user: a, workspace: w, membership: { role: "ADMIN" } };
  member = { user: m, workspace: w, membership: { role: "MEMBER" } };
  guest = { user: g, workspace: w, membership: { role: "GUEST" } };
  other = { ...owner, workspace: w2 };
});
afterAll(async () => {
  await cleanup(slugs, domain);
  await prisma.$disconnect();
});
describe.sequential("application secrets security", () => {
  it("encrypts each value and version with independent keys; excludes plaintext from search, logs, notifications and activity", async () => {
    const p = await project(),
      value = "security-sentinel-never-index-791";
    const log = vi.spyOn(console, "log"),
      error = vi.spyOn(console, "error");
    try {
      await changeSecrets(owner, p.dev.id, [
        { key: "API_KEY", path: "/", value },
      ]);
      await changeSecrets(owner, p.dev.id, [
        { key: "API_KEY", path: "/", value: value + "-changed" },
      ]);
      const row = await prisma.applicationSecret.findFirstOrThrow({
        where: { workspaceId: owner.workspace.id, environmentId: p.dev.id },
      });
      const versions = await prisma.applicationSecretVersion.findMany({
        where: { workspaceId: owner.workspace.id, secretId: row.id },
      });
      expect(versions).toHaveLength(2);
      expect(new Set(versions.map((v) => v.secretEnc)).size).toBe(2);
      expect(await openValue(row)).toBe(value + "-changed");
      const recorded = await Promise.all([
        prisma.searchDocument.findMany({
          where: { workspaceId: owner.workspace.id },
        }),
        prisma.activityEvent.findMany({
          where: { workspaceId: owner.workspace.id },
        }),
        prisma.auditEvent.findMany({
          where: { workspaceId: owner.workspace.id },
        }),
        prisma.secretSnapshot.findMany({
          where: { workspaceId: owner.workspace.id },
        }),
        prisma.notificationEventRecord.findMany({
          where: { workspaceId: owner.workspace.id },
        }),
      ]);
      expect(
        JSON.stringify([
          row,
          versions,
          recorded,
          log.mock.calls,
          error.mock.calls,
        ]),
      ).not.toContain(value);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
  it("encrypts and reveals empty values without changing their meaning", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "EMPTY", path: "/", value: "" },
    ]);
    expect(await readSecrets(owner, p.dev.id, "/", { key: "EMPTY" })).toEqual({
      EMPTY: "",
    });
    const stored = await prisma.applicationSecret.findFirstOrThrow({
      where: {
        workspaceId: owner.workspace.id,
        environmentId: p.dev.id,
        key: "EMPTY",
      },
    });
    expect(stored.secretEnc).not.toBe("");
    expect(await openValue(stored)).toBe("");
  });
  it("enforces tenant isolation, keys-only/read/write grants and production admin defaults", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "KEY", path: "/", value: "private" },
    ]);
    await expect(readSecrets(other, p.dev.id, "/")).rejects.toThrow();
    await expect(readSecrets(guest, p.dev.id, "/")).rejects.toThrow();
    await expect(
      changeSecrets(member, p.dev.id, [{ key: "KEY", path: "/", value: "no" }]),
    ).rejects.toThrow();
    await saveGrant(owner, {
      projectId: p.id,
      userId: member.user.id,
      role: "KEYS",
    });
    expect((await loadSecrets(member, p.id, p.dev.id)).rows[0].key).toBe("KEY");
    await expect(readSecrets(member, p.dev.id, "/")).rejects.toThrow();
    await saveGrant(owner, {
      projectId: p.id,
      userId: member.user.id,
      role: "READ",
    });
    expect(await readSecrets(member, p.dev.id, "/", { key: "KEY" })).toEqual({
      KEY: "private",
    });
    await expect(
      changeSecrets(member, p.dev.id, [{ key: "KEY", path: "/", value: "no" }]),
    ).rejects.toThrow();
    await expect(
      environmentAccess(member, p.production.id, "KEYS"),
    ).rejects.toThrow();
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "NONE",
    });
    await expect(readSecrets(member, p.dev.id, "/")).rejects.toThrow();
    await expect(
      saveGrant(other, {
        projectId: p.id,
        userId: member.user.id,
        role: "READ",
      }),
    ).rejects.toThrow();
  });
  it("blocks production reveals and every member export without fresh MFA", async () => {
    const p = await project();
    await saveEnvironment(owner, { ...p.production, protected: false });
    await changeSecrets(owner, p.production.id, [
      { key: "PROD", path: "/", value: "protected-value" },
    ]);
    await expect(
      readSecrets(owner, p.production.id, "/", { key: "PROD" }),
    ).rejects.toThrow("two-step");
    const verified = { ...owner, proof: await proof(owner) };
    expect(
      await readSecrets(verified, p.production.id, "/", { key: "PROD" }),
    ).toEqual({ PROD: "protected-value" });
    await expect(
      readSecrets(owner, p.dev.id, "/", { exporting: true }),
    ).rejects.toThrow("two-step");
    await expect(
      readSecrets(
        { ...owner, cliMfaAt: new Date(Date.now() - 301000) },
        p.production.id,
        "/",
        { key: "PROD" },
      ),
    ).rejects.toThrow("two-step");
    await expect(
      readSecrets(
        { ...owner, proof: verified.proof + "x" },
        p.production.id,
        "/",
      ),
    ).rejects.toThrow("two-step");
  });
  it("resolves references only within project and permitted environment/folder; detects cycles and missing keys", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "BASE", path: "/", value: "https://example.org" },
      { key: "URL", path: "/", value: "${BASE}/${staging.api.VERSION}" },
    ]);
    await changeSecrets(owner, p.staging.id, [
      { key: "VERSION", path: "/api", value: "v1" },
    ]);
    expect(await readSecrets(owner, p.dev.id, "/", { key: "URL" })).toEqual({
      URL: "https://example.org/v1",
    });
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "READ",
    });
    await expect(
      readSecrets(member, p.dev.id, "/", { key: "URL" }),
    ).rejects.toThrow("access");
    await changeSecrets(owner, p.dev.id, [
      { key: "CYCLE", path: "/", value: "${CYCLE}" },
      { key: "MISSING", path: "/", value: "${NOWHERE}" },
    ]);
    await expect(
      readSecrets(owner, p.dev.id, "/", { key: "CYCLE" }),
    ).rejects.toThrow("cycle");
    await expect(
      readSecrets(owner, p.dev.id, "/", { key: "MISSING" }),
    ).rejects.toThrow("unavailable");
  });
  it("keeps protected edits pending until an independent admin approves; rejects stale revisions", async () => {
    const p = await project();
    const first = await changeSecrets(owner, p.production.id, [
      { key: "TOKEN", path: "/", value: "first" },
    ]);
    expect(first.pending).toBe(true);
    expect(
      await prisma.applicationSecret.count({
        where: {
          workspaceId: owner.workspace.id,
          environmentId: p.production.id,
        },
      }),
    ).toBe(0);
    const request = await prisma.approvalRequest.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, subjectId: first.changeId },
    });
    expect(request.title).toContain("production");
    expect(
      (await decide(owner, { requestId: request.id, decision: "APPROVED" })).ok,
    ).toBe(false);
    expect(
      (await decide(admin, { requestId: request.id, decision: "APPROVED" })).ok,
    ).toBe(true);
    const a = await changeSecrets(owner, p.production.id, [
      { key: "TOKEN", path: "/", value: "second" },
    ]);
    const b = await changeSecrets(owner, p.production.id, [
      { key: "TOKEN", path: "/", value: "stale" },
    ]);
    const requests = await prisma.approvalRequest.findMany({
      where: {
        workspaceId: owner.workspace.id,
        subjectId: { in: [a.changeId!, b.changeId!] },
      },
    });
    expect(
      (
        await decide(admin, {
          requestId: requests.find((r) => r.subjectId === a.changeId)!.id,
          decision: "APPROVED",
        })
      ).ok,
    ).toBe(true);
    await expect(
      decide(admin, {
        requestId: requests.find((r) => r.subjectId === b.changeId)!.id,
        decision: "APPROVED",
      }),
    ).rejects.toThrow("changed");
    expect(
      await openValue(
        await prisma.applicationSecret.findFirstOrThrow({
          where: {
            workspaceId: owner.workspace.id,
            environmentId: p.production.id,
          },
        }),
      ),
    ).toBe("second");
  });
  it("supports conflict-checked import previews, encrypted history, restore and environment rollback", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "A", path: "/", value: "one" },
    ]);
    const preview = await previewImport(owner, p.dev.id, "/", "A=one\nB=two");
    expect(preview.diff.map((d) => d.operation)).toEqual(["unchanged", "add"]);
    await importSecrets(owner, p.dev.id, "/", "A=one\nB=two", preview.revision);
    await expect(
      importSecrets(owner, p.dev.id, "/", "A=bad", preview.revision),
    ).rejects.toThrow("changed");
    const snap = await takeSnapshot(owner, p.dev.id, "Before changes");
    const secret = await prisma.applicationSecret.findFirstOrThrow({
      where: {
        workspaceId: owner.workspace.id,
        environmentId: p.dev.id,
        key: "A",
      },
    });
    const versions = await secretHistory(owner, p.dev.id, secret.id);
    await changeSecrets(owner, p.dev.id, [
      { key: "A", path: "/", value: "next" },
      { key: "EXTRA", path: "/", value: "extra" },
    ]);
    expect(
      (await snapshotDiff(owner, p.dev.id, snap)).some(
        (d) => d.key === "EXTRA" && d.operation === "delete",
      ),
    ).toBe(true);
    await rollbackSnapshot(owner, p.dev.id, snap);
    expect(await readSecrets(owner, p.dev.id, "/")).toEqual({
      A: "one",
      B: "two",
    });
    expect(
      await revealVersion(owner, p.dev.id, secret.id, versions[0].id),
    ).toBe("one");
    await restoreVersion(owner, p.dev.id, secret.id, versions[0].id);
    const allVersions = await secretHistory(owner, p.dev.id, secret.id);
    expect(
      (await secretHistory(owner, p.dev.id, secret.id, allVersions[0].id)).map(
        (v) => v.id,
      ),
    ).toEqual(allVersions.slice(1).map((v) => v.id));
    const olderSnapshots = (await loadSecrets(owner, p.id, p.dev.id, "/", snap))
      .snapshots;
    expect(olderSnapshots.length).toBeGreaterThan(0);
    expect(olderSnapshots.map((s) => s.id)).not.toContain(snap);
    await expect(
      loadSecrets(owner, p.id, p.staging.id, "/", snap),
    ).rejects.toThrow("snapshot page");
    await expect(rollbackSnapshot(other, p.dev.id, snap)).rejects.toThrow();
  });
  it("pages active keys despite deleted rows and rejects cursors outside the active scope", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [{ key: "DELETED", path: "/", value: "fixture" }]);
    await changeSecrets(owner, p.dev.id, [{ key: "DELETED", path: "/", delete: true }]);
    const deleted = await prisma.applicationSecret.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, environmentId: p.dev.id, key: "DELETED" } });
    const metadata = { workspaceId: owner.workspace.id, environmentId: p.dev.id, ownerId: owner.user.id, secretEnc: "unused", dataKeyEnc: "unused" };
    await prisma.applicationSecret.createMany({ data: [
      ...Array.from({ length: 2000 }, (_, i) => ({ ...metadata, key: `DELETED_${i}`, deletedAt: new Date() })),
      ...Array.from({ length: 2001 }, (_, i) => ({ ...metadata, key: `KEY_${String(i).padStart(4, "0")}` })),
    ] });
    const first = await loadSecrets(owner, p.id, p.dev.id);
    expect(first.rows).toHaveLength(2000);
    expect(first.rows.every(row => row.deletedAt === null)).toBe(true);
    expect(first.rows[0].key).toBe("KEY_0000");
    expect(first.nextKeysCursor).toBe(first.rows.at(-1)?.id);
    const next = await loadSecrets(owner, p.id, p.dev.id, "/", undefined, first.nextKeysCursor);
    expect(next.rows.map(row => row.key)).toEqual(["KEY_2000"]);
    expect(next.nextKeysCursor).toBeUndefined();
    expect(await secretHistory(owner, p.dev.id, deleted.id)).toHaveLength(2);
    for (const [environmentId, path, cursor] of [
      [p.dev.id, "/", deleted.id],
      [p.staging.id, "/", first.nextKeysCursor],
      [p.dev.id, "/other", first.nextKeysCursor],
    ] as const) {
      await expect(loadSecrets(owner, p.id, environmentId, path, undefined, cursor)).rejects.toThrow("keys page");
    }
    const foreign = await createProject(other, { name: "Foreign cursor", slug: `foreign-${++counter}` });
    await expect(loadSecrets(other, foreign, undefined, "/", undefined, first.nextKeysCursor)).rejects.toThrow("keys page");
  });
  it.each([
    { keys: 501, extras: 1, protected: false },
    { keys: 250, extras: 251, protected: true },
  ])("restores $keys snapshot keys plus $extras deletions in one change (protected: $protected)", async (scenario) => {
    const p = await project();
    const original = Array.from({ length: scenario.keys }, (_, i) => ({ key: `KEY_${i}`, path: "/", value: `original-${i}` }));
    for (let i = 0; i < original.length; i += 500)
      await changeSecrets(owner, p.dev.id, original.slice(i, i + 500));
    const snap = await takeSnapshot(owner, p.dev.id, "Complete recovery point");
    await changeSecrets(owner, p.dev.id, [
      { key: "KEY_0", path: "/", value: "changed" },
      ...Array.from({ length: scenario.extras }, (_, i) => ({ key: `EXTRA_${i}`, path: "/", value: "remove-on-restore" })),
    ]);
    // Recovery must not remove the public change/import limits.
    await expect(changeSecrets(owner, p.dev.id, Array.from({ length: 501 }, (_, i) => ({ key: `IMPORT_${i}`, path: "/", value: "bounded" })))).rejects.toThrow("Check the fields");
    await expect(previewImport(owner, p.dev.id, "/", Array.from({ length: 501 }, (_, i) => `IMPORT_${i}=bounded`).join("\n"))).rejects.toThrow();
    await expect(rollbackSnapshot(member, p.dev.id, snap)).rejects.toThrow("access");
    await expect(rollbackSnapshot({ ...owner, machine: { id: "machine", environmentId: p.dev.id, path: "/", writable: true } }, p.dev.id, snap)).rejects.toThrow("member account");
    if (scenario.protected) await saveEnvironment(owner, { ...p.dev, protected: true });
    const before = await prisma.secretEnvironment.findUniqueOrThrow({ where: { id: p.dev.id } });
    const snapshotsBefore = await prisma.secretSnapshot.count({ where: { workspaceId: owner.workspace.id, environmentId: p.dev.id } });
    const result = await rollbackSnapshot(owner, p.dev.id, snap);
    expect(result.pending).toBe(scenario.protected);
    if (scenario.protected) {
      expect(await readSecrets(owner, p.dev.id, "/", { key: "KEY_0" })).toEqual({ KEY_0: "changed" });
      expect((await prisma.secretEnvironment.findUniqueOrThrow({ where: { id: p.dev.id } })).revision).toBe(before.revision);
      const stale = await rollbackSnapshot(owner, p.dev.id, snap);
      if (!("changeId" in result) || !result.changeId || !("changeId" in stale) || !stale.changeId)
        throw new Error("Protected recovery must create approval requests.");
      const request = await prisma.approvalRequest.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, subjectId: result.changeId } });
      expect((await decide(owner, { requestId: request.id, decision: "APPROVED" })).ok).toBe(false);
      expect((await decide(admin, { requestId: request.id, decision: "APPROVED" })).ok).toBe(true);
      const staleRequest = await prisma.approvalRequest.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, subjectId: stale.changeId } });
      await expect(decide(admin, { requestId: staleRequest.id, decision: "APPROVED" })).rejects.toThrow("changed");
    }
    expect(await readSecrets(owner, p.dev.id, "/")).toEqual(Object.fromEntries(original.map(row => [row.key, row.value])));
    // A full recovery advances the revision and snapshots exactly once, rather than batching commits.
    expect((await prisma.secretEnvironment.findUniqueOrThrow({ where: { id: p.dev.id } })).revision).toBe(before.revision + 1);
    expect(await prisma.secretSnapshot.count({ where: { workspaceId: owner.workspace.id, environmentId: p.dev.id } })).toBe(snapshotsBefore + 1);
    expect(await prisma.applicationSecret.count({ where: { workspaceId: owner.workspace.id, environmentId: p.dev.id, deletedAt: { not: null }, key: { startsWith: "EXTRA_" } } })).toBe(scenario.extras);
  }, 120000);
  it("recovers history when the historic owner has left without changing access grants", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "HANDOVER", path: "/", value: "original", ownerId: admin.user.id },
    ]);
    const row = await prisma.applicationSecret.findFirstOrThrow({
      where: {
        workspaceId: owner.workspace.id,
        environmentId: p.dev.id,
        key: "HANDOVER",
      },
    });
    const version = (await secretHistory(owner, p.dev.id, row.id))[0];
    const snap = await takeSnapshot(owner, p.dev.id, "Before handover");
    await changeSecrets(owner, p.dev.id, [
      { key: "HANDOVER", path: "/", value: "changed", ownerId: owner.user.id },
    ]);
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          userId: admin.user.id,
          workspaceId: admin.workspace.id,
        },
      },
      data: { status: "SUSPENDED" },
    });
    try {
      await restoreVersion(owner, p.dev.id, row.id, version.id);
      expect(
        await readSecrets(owner, p.dev.id, "/", { key: "HANDOVER" }),
      ).toEqual({ HANDOVER: "original" });
      await changeSecrets(owner, p.dev.id, [
        { key: "HANDOVER", path: "/", delete: true },
      ]);
      await rollbackSnapshot(owner, p.dev.id, snap);
      expect(
        await prisma.applicationSecret.findUniqueOrThrow({
          where: { id: row.id },
        }),
      ).toMatchObject({ ownerId: owner.user.id, deletedAt: null });
      expect(
        await prisma.secretGrant.count({
          where: { workspaceId: owner.workspace.id, projectId: p.id },
        }),
      ).toBe(0);
    } finally {
      await prisma.membership.update({
        where: {
          userId_workspaceId: {
            userId: admin.user.id,
            workspaceId: admin.workspace.id,
          },
        },
        data: { status: "ACTIVE" },
      });
    }
  });
  it("enforces service token scope, expiry, exact path, IP rules, revocation and creator membership", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "TOKEN", path: "/api", value: "service-only" },
      { key: "ROOT", path: "/", value: "root" },
    ]);
    const raw = await createServiceToken(owner, p.dev.id, {
      name: "Deploy",
      path: "/api",
      ipAllowlist: ["192.0.2.0/24"],
      expiresAt: new Date(Date.now() + 60000),
    });
    expect(await authenticateServiceToken(raw, "198.51.100.1")).toBeNull();
    const actor = (await authenticateServiceToken(raw, "192.0.2.9"))!;
    expect(
      await readSecrets(actor, p.dev.id, "/api", { exporting: true }),
    ).toEqual({ TOKEN: "service-only" });
    await expect(readSecrets(actor, p.dev.id, "/")).rejects.toThrow("folder");
    await expect(readSecrets(actor, p.staging.id, "/api")).rejects.toThrow();
    await expect(
      changeSecrets(actor, p.dev.id, [
        { key: "TOKEN", path: "/api", value: "no" },
      ]),
    ).rejects.toThrow();
    expect(await authenticateServiceToken(raw + "x", "192.0.2.9")).toBeNull();
    expect(
      await authenticateServiceToken(
        raw,
        "192.0.2.9",
        new Date(Date.now() + 61000),
      ),
    ).toBeNull();
    await revokeServiceToken(owner, p.dev.id, actor.machine!.id);
    expect(await authenticateServiceToken(raw, "192.0.2.9")).toBeNull();
    const writable = await createServiceToken(owner, p.dev.id, {
      name: "CI",
      path: "/",
      writable: true,
    });
    const writer = (await authenticateServiceToken(writable, "unknown"))!;
    await changeSecrets(writer, p.dev.id, [
      { key: "ROOT", path: "/", value: "changed" },
    ]);
    const adminToken = await createServiceToken(admin, p.dev.id, {
      name: "Admin runner",
      path: "/",
    });
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          userId: admin.user.id,
          workspaceId: admin.workspace.id,
        },
      },
      data: { status: "SUSPENDED" },
    });
    try {
      expect(await authenticateServiceToken(adminToken, "unknown")).toBeNull();
    } finally {
      await prisma.membership.update({
        where: {
          userId_workspaceId: {
            userId: admin.user.id,
            workspaceId: admin.workspace.id,
          },
        },
        data: { status: "ACTIVE" },
      });
    }
    expect(ipAllowed("2001:db8::12", ["2001:db8::/32"])).toBe(true);
    expect(ipAllowed("unknown", ["192.0.2.1"])).toBe(false);
    expect(ipAllowed("192.0.2.1", ["0.0.0.0/99"])).toBe(false);
  });
  it("exposes the scoped REST API to machines, never generic assistant tokens", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "CLI_KEY", path: "/", value: "cli-test" },
    ]);
    const raw = await createServiceToken(owner, p.dev.id, {
      name: "Deploy",
      path: "/",
    });
    const url = `http://localhost:3100/api/v1/secrets?project=${p.id}&environment=dev&path=/&format=json`;
    const response = await GET(
      new NextRequest(url, { headers: { authorization: `Bearer ${raw}` } }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ CLI_KEY: "cli-test" });
    expect(
      (
        await GET(
          new NextRequest(url, {
            headers: { authorization: "Bearer sww_generic_assistant_token" },
          }),
        )
      ).status,
    ).toBe(403);
    const write = await POST(
      new NextRequest(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${raw}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          project: p.id,
          environment: "dev",
          changes: [{ key: "NO", path: "/", value: "no" }],
        }),
      }),
    );
    expect(write.status).toBe(403);
  });
  it("keeps names in search behind live environment access even with stale broad index metadata", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      {
        key: "SEARCHABLE_KEY",
        path: "/",
        value: "never-searchable-value",
        ownerId: member.user.id,
      },
    ]);
    const row = await prisma.applicationSecret.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, environmentId: p.dev.id },
    });
    await prisma.searchDocument.updateMany({
      where: { workspaceId: owner.workspace.id, entityId: row.id },
      data: { visibility: "WORKSPACE" },
    });
    const actor = {
      workspaceId: owner.workspace.id,
      userId: member.user.id,
      role: "MEMBER" as const,
    };
    expect(await searchDocuments(actor, "SEARCHABLE_KEY")).toEqual([]);
    await saveGrant(owner, {
      projectId: p.id,
      userId: member.user.id,
      role: "KEYS",
    });
    expect(
      (await searchDocuments(actor, "SEARCHABLE_KEY")).map((r) => r.entityId),
    ).toContain(row.id);
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "NONE",
    });
    expect(await searchDocuments(actor, "SEARCHABLE_KEY")).toEqual([]);
  });
  it("consumes fragment-encrypted shares once atomically, expires them and never stores their key", async () => {
    const p = await project();
    const key = await webcrypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      ),
      iv = webcrypto.getRandomValues(new Uint8Array(12)),
      encrypted = await webcrypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode("share-only-value"),
      );
    const ciphertext =
      Buffer.from(iv).toString("base64url") +
      "." +
      Buffer.from(encrypted).toString("base64url");
    const capability = await createShare(owner, p.dev.id, {
      ciphertext,
      hours: 1,
      views: 1,
    });
    const stored = await prisma.secretShare.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, projectId: p.id },
    });
    expect(JSON.stringify(stored)).not.toContain("share-only-value");
    expect(JSON.stringify(stored)).not.toContain(capability);
    const attempts = await Promise.allSettled([
      consumeShare(capability),
      consumeShare(capability),
    ]);
    expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.secretShare.count({
        where: { workspaceId: owner.workspace.id, id: stored.id },
      }),
    ).toBe(0);
    const expired = await createShare(owner, p.dev.id, {
      ciphertext,
      hours: 1,
      views: 2,
    });
    await expect(
      consumeShare(expired, new Date(Date.now() + 3600001)),
    ).rejects.toThrow("expired");
    await prisma.workspace.update({
      where: { id: owner.workspace.id },
      data: { archivedAt: new Date() },
    });
    try {
      await run(new Date(Date.now() + 3600001));
      expect(
        await prisma.secretShare.count({
          where: { workspaceId: owner.workspace.id, projectId: p.id },
        }),
      ).toBe(0);
    } finally {
      await prisma.workspace.update({
        where: { id: owner.workspace.id },
        data: { archivedAt: null },
      });
    }
  });
  it("deduplicates rotation reminders and never includes secret values", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      {
        key: "ROTATE",
        path: "/",
        value: "rotation-private-value",
        rotateEveryDays: 1,
      },
    ]);
    await prisma.applicationSecret.updateMany({
      where: { workspaceId: owner.workspace.id, environmentId: p.dev.id },
      data: { rotatedAt: new Date(Date.now() - 3 * 86400000) },
    });
    await run();
    await run();
    const events = await prisma.notificationEventRecord.findMany({
      where: { workspaceId: owner.workspace.id, type: "secrets.rotation_due" },
    });
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain("rotation-private-value");
  });
});
describe.sequential("CLI device authorisation and sessions", () => {
  it("applies user CLI environment permissions and revocation to the read/write API", async () => {
    const p = await project();
    await changeSecrets(owner, p.dev.id, [
      { key: "USER_CLI", path: "/", value: "user-scoped" },
    ]);
    const device = await issueDeviceCode({ deviceName: "Scope test" });
    await approveDeviceCode(member.user.id, device.user_code, true);
    const issued = await pollDeviceCode(device.device_code);
    if (!("access_token" in issued)) throw new Error("Token issuance failed");
    const raw = issued.access_token!;
    const url = `http://localhost:3100/api/v1/secrets?project=${p.id}&environment=dev&path=/&key=USER_CLI`;
    const request = () =>
      new NextRequest(url, { headers: { authorization: `Bearer ${raw}` } });
    expect((await GET(request())).status).toBe(403);
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "READ",
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ USER_CLI: "user-scoped" });
    const write = () =>
      new NextRequest(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${raw}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          project: p.id,
          environment: "dev",
          changes: [{ key: "USER_CLI", path: "/", value: "written" }],
        }),
      });
    expect((await POST(write())).status).toBe(403);
    await saveGrant(owner, {
      projectId: p.id,
      environmentId: p.dev.id,
      userId: member.user.id,
      role: "WRITE",
    });
    expect((await POST(write())).status).toBe(200);
    expect(
      await authenticateCliToken(raw, new Date(Date.now() + 901000)),
    ).toBeNull();
    const session = (await authenticateCliToken(raw))!;
    await revokeCliSession(member.user.id, session.id);
    expect((await GET(request())).status).toBe(403);
  });

  it("approves, polls once, hashes tokens, refreshes atomically and revokes", async () => {
    const now = new Date(),
      device = await issueDeviceCode({ deviceName: "Test terminal" }, now);
    expect((await pollDeviceCode(device.device_code, now)).error).toBe(
      "authorization_pending",
    );
    expect(
      (await pollDeviceCode(device.device_code, new Date(now.getTime() + 1000)))
        .error,
    ).toBe("slow_down");
    await approveDeviceCode(
      member.user.id,
      device.user_code,
      true,
      undefined,
      now,
    );
    const result = await pollDeviceCode(
      device.device_code,
      new Date(now.getTime() + 5100),
    );
    if (!("access_token" in result)) throw new Error("Token issuance failed");
    const session = await authenticateCliToken(result.access_token!);
    expect(session?.userId).toBe(member.user.id);
    const row = await prisma.cliSession.findUniqueOrThrow({
      where: { id: session!.id },
    });
    expect(JSON.stringify(row)).not.toContain(result.access_token);
    expect(JSON.stringify(row)).not.toContain(result.refresh_token);
    expect(
      (
        await pollDeviceCode(
          device.device_code,
          new Date(now.getTime() + 11000),
        )
      ).error,
    ).toBe("invalid_grant");
    const refreshed = await refreshCliToken(result.refresh_token!);
    expect(await authenticateCliToken(result.access_token!)).toBeNull();
    await expect(refreshCliToken(result.refresh_token!)).rejects.toThrow(
      "Sign in",
    );
    await revokeCliSession(member.user.id, session!.id);
    expect(await authenticateCliToken(refreshed.access_token)).toBeNull();
    await expect(refreshCliToken(refreshed.refresh_token)).rejects.toThrow(
      "Sign in",
    );
  });
  it("handles denied, expired, unknown and concurrent poll requests", async () => {
    const now = new Date(),
      denied = await issueDeviceCode({ deviceName: "Denied" }, now);
    await approveDeviceCode(
      member.user.id,
      denied.user_code,
      false,
      undefined,
      now,
    );
    expect((await pollDeviceCode(denied.device_code, now)).error).toBe(
      "access_denied",
    );
    const expired = await issueDeviceCode({ deviceName: "Expired" }, now);
    expect(
      (
        await pollDeviceCode(
          expired.device_code,
          new Date(now.getTime() + 601000),
        )
      ).error,
    ).toBe("expired_token");
    expect((await pollDeviceCode("invalid", now)).error).toBe("invalid_grant");
    const concurrent = await issueDeviceCode({ deviceName: "Concurrent" }, now);
    await approveDeviceCode(
      member.user.id,
      concurrent.user_code,
      true,
      undefined,
      now,
    );
    const responses = await Promise.all([
      pollDeviceCode(concurrent.device_code, now),
      pollDeviceCode(concurrent.device_code, now),
    ]);
    expect(responses.filter((r) => "access_token" in r)).toHaveLength(1);
  });
  it("requires enabled members' fresh MFA, invalidates sessions with account version, and never permits revoking another user's session", async () => {
    const device = await issueDeviceCode({ deviceName: "MFA terminal" });
    await expect(
      approveDeviceCode(owner.user.id, device.user_code, true),
    ).rejects.toThrow("two-step");
    const fresh = await proof(owner);
    await approveDeviceCode(owner.user.id, device.user_code, true, fresh);
    const result = await pollDeviceCode(device.device_code);
    if (!("access_token" in result)) throw new Error("Token issuance failed");
    const session = (await authenticateCliToken(result.access_token!))!;
    await revokeCliSession(member.user.id, session.id);
    expect(await authenticateCliToken(result.access_token!)).not.toBeNull();
    await prisma.user.update({
      where: { id: owner.user.id },
      data: { sessionVersion: { increment: 1 } },
    });
    expect(await authenticateCliToken(result.access_token!)).toBeNull();
  });
});
