import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { addEntry } from "@/lib/finance/tools/service";
import {
  uploadFinanceFiles,
  claimStagedFiles,
  purgeExpiredStagedFiles,
  removeFinanceFile,
} from "@/lib/finance/tools/files";
import { extractReceipt } from "@/lib/finance/tools/extract";
import { financeReports } from "@/lib/finance/tools/queries";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { ai, owner, admin, member, guest, entry, receipt } from "./fixtures";

export function registerProofExtractionTests() {
  it("uploads multiple private files and protects staged ownership", async () => {
    const uploaded = await uploadFinanceFiles(owner, "STAGED", owner.user.id, [
      receipt(),
      receipt(),
    ]);
    expect(uploaded).toHaveLength(2);
    expect(
      await findDownloadableFile(uploaded[0]!.id, admin.user.id),
    ).toBeNull();
    await expect(
      prisma.$transaction((tx) =>
        claimStagedFiles(tx, admin, [uploaded[0]!.id], "LEDGER", "fake"),
      ),
    ).rejects.toThrow("newly uploaded");
    const id = await addEntry(
      owner,
      entry({ fileIds: uploaded.map((f) => f.id) }),
    );
    expect(
      await findDownloadableFile(uploaded[0]!.id, member.user.id),
    ).not.toBeNull();
    expect(
      await findDownloadableFile(uploaded[0]!.id, guest.user.id),
    ).toBeNull();
    expect(
      await prisma.fileObject.count({
        where: {
          id: { in: uploaded.map((f) => f.id) },
          ...(await libraryWhere({
            workspace: owner.workspace,
            user: owner.user,
            membership: owner.membership,
          })),
        },
      }),
    ).toBe(0);
    expect(
      (await financeReports(owner, { month: "2026-06" })).entries.find(
        (e) => e.id === id,
      )?.receipts,
    ).toHaveLength(2);
  });
  it("isolates staged form ids and expires only unclaimed proof", async () => {
    const stage = randomUUID();
    const [pending] = await uploadFinanceFiles(owner, "STAGED", stage, [
      receipt(),
    ]);
    expect(await findDownloadableFile(pending!.id, admin.user.id)).toBeNull();
    await expect(
      removeFinanceFile(admin, pending!.attachmentId),
    ).rejects.toThrow("unavailable");
    const [committed] = await uploadFinanceFiles(
      owner,
      "STAGED",
      randomUUID(),
      [receipt()],
    );
    await addEntry(owner, entry({ fileIds: [committed!.id] }));
    await prisma.financeAttachment.updateMany({
      where: {
        workspaceId: owner.workspace.id,
        fileId: { in: [pending!.id, committed!.id] },
      },
      data: { createdAt: new Date(Date.now() - 2 * 86400000) },
    });
    await prisma.$transaction((tx) =>
      purgeExpiredStagedFiles(tx, owner.workspace.id, new Date()),
    );
    expect(
      await prisma.fileObject.count({
        where: { workspaceId: owner.workspace.id, id: pending!.id },
      }),
    ).toBe(0);
    expect(
      await prisma.fileObject.count({
        where: { workspaceId: owner.workspace.id, id: committed!.id },
      }),
    ).toBe(1);
  });
  it("keeps extraction optional, uses the configured model, and never posts unconfirmed entries", async () => {
    const [file] = await uploadFinanceFiles(owner, "STAGED", owner.user.id, [
      receipt(),
    ]);
    const before = await prisma.ledgerEntry.count({
      where: { workspaceId: owner.workspace.id },
    });
    ai.configured = false;
    expect(await extractReceipt(owner, file!.id)).toEqual({
      configured: false,
    });
    expect(ai.called).toBe(0);
    ai.configured = true;
    expect(await extractReceipt(owner, file!.id)).toMatchObject({
      configured: true,
      fields: { vendor: "Receipt supplier", total: "118" },
    });
    expect(
      await prisma.ledgerEntry.count({
        where: { workspaceId: owner.workspace.id },
      }),
    ).toBe(before);
    const id = await addEntry(owner, entry({ fileIds: [file!.id] }));
    expect(
      (
        await prisma.ledgerEntry.findFirstOrThrow({
          where: { id, workspaceId: owner.workspace.id },
        })
      ).extractionUsed,
    ).toBe(true);
  });
}
