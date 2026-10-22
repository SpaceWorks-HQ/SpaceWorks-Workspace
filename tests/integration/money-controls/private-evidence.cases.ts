import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { removeControlFile } from "@/lib/moneyControls/files";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { getObject } from "@/lib/storage";
import { actor, admin, member, bank, keys, save, transition, attach } from "./fixtures";

export function registerPrivateEvidenceTests() {
  it("retains private evidence, prevents library mutation and rechecks current rights", async () => {
    const id = await save("DEPOSIT", {
        accountId: bank,
        amountMinor: 1000,
        details: {
          direction: "RECEIVED",
          counterparty: "Internal lease partner",
        },
      }),
      f = await attach(id);
    expect(await findDownloadableFile(f.id, member.user.id)).toBeNull();
    expect(await findDownloadableFile(f.id, actor.user.id)).not.toBeNull();
    expect(
      await prisma.fileObject.count({
        where: { AND: [await libraryWhere(actor), { id: f.id }] },
      }),
    ).toBe(0);
    expect(await getObject(keys.at(-1)!)).not.toBeNull();
    await transition(id);
    await expect(removeControlFile(actor, f.id)).rejects.toThrow(/retained/);
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          workspaceId: actor.workspace.id,
          userId: admin.user.id,
        },
      },
      data: { status: "SUSPENDED" },
    });
    expect(await findDownloadableFile(f.id, admin.user.id)).toBeNull();
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          workspaceId: actor.workspace.id,
          userId: admin.user.id,
        },
      },
      data: { status: "ACTIVE" },
    });
  });
}
