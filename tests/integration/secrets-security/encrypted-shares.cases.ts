import { it, expect } from "vitest";
import { webcrypto } from "node:crypto";
import { prisma } from "@/lib/db";
import { createShare, consumeShare } from "@/lib/secrets/shares";
import { run } from "@/lib/scheduled/secrets";
import { owner, project } from "./fixtures";

export function registerEncryptedShareTests() {
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
}
