import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  createProject,
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
import { loadSecrets } from "@/lib/secrets/queries";
import { decide } from "@/lib/approvals/engine";
import { owner, admin, member, other, project, records } from "./fixtures";

export function registerHistoryRecoveryTests() {
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
    const foreign = await createProject(other, {
      name: "Foreign cursor",
      slug: `foreign-${++records.counter}`,
    });
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
}
