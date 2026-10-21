import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mutateChangelog } from "@/lib/changelog/service";
import { owner, member } from "./fixtures";

export function registerChangelogPublishingTests() {
  it("publishes internal changelog entries", async () => {
    const e = await mutateChangelog(owner, {
      op: "create",
      title: "Repair station ready",
      bodyMd: "The crew can repair small appliances.",
      audience: "PUBLIC",
      version: "1.0",
      tags: ["workshop"],
    });
    await mutateChangelog(owner, {
      op: "publish",
      entryId: e.id,
      publishedAt: new Date(),
    });
    expect((await prisma.changelogEntry.findUniqueOrThrow({ where: { id: e.id } })).publishedAt).not.toBeNull();
    await expect(
      mutateChangelog(member, {
        op: "create",
        title: "Not authorised",
        bodyMd: "Test",
      }),
    ).rejects.toThrow();
  });
}
