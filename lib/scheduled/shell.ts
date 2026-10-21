import "server-only";
import { prisma } from "@/lib/db";
import { purgeWorkspace } from "@/lib/shell/retention";
import { deleteObjects } from "@/lib/storage";
import { processExport } from "./shell-export";
import { processImport } from "./shell-import";
import { flushDigest } from "./shell-digest";

export { processExport, processImport, flushDigest };

export async function run(now: Date): Promise<void> {
  await processExport(now);
  await processImport(now);
  await flushDigest(now);
  // Expired downloads are denied independently of this object cleanup.
  const expired = await prisma.exportJob.findMany({
    where: {
      expiresAt: { lt: now },
      storageKey: { not: null },
      workspace: { legalHold: false },
    },
    take: 20,
  });
  for (const job of expired)
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ legalHold: boolean }>
      >`SELECT "legalHold" FROM "Workspace" WHERE id=${job.workspaceId} FOR UPDATE`;
      if (rows[0]?.legalHold) return;
      await deleteObjects([job.storageKey!]);
      await tx.exportJob.updateMany({
        where: {
          id: job.id,
          workspaceId: job.workspaceId,
          storageKey: job.storageKey,
        },
        data: { storageKey: null },
      });
    });
  const workspaces = await prisma.workspace.findMany({
    where: { legalHold: false },
    select: { id: true },
  });
  for (const workspace of workspaces) await purgeWorkspace(workspace.id, now);
}
