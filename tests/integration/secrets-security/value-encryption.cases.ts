import { it, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  changeSecrets,
  readSecrets,
} from "@/lib/secrets/service";
import { openValue } from "@/lib/secrets/encryption";
import { owner, project } from "./fixtures";

export function registerValueEncryptionTests() {
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
}
