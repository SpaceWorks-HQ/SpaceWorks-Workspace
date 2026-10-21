import "server-only";
import { prisma } from "@/lib/db";
import type { FinanceActor } from "@/lib/finance/tools/access";

export async function files(actor: FinanceActor, type: string, ids: string[]) {
  const rows = await prisma.financeAttachment.findMany({
    where: {
      workspaceId: actor.workspace.id,
      recordType: type,
      recordId: { in: ids },
      file: { deletedAt: null },
    },
    select: {
      id: true,
      recordId: true,
      file: { select: { id: true, filename: true, contentType: true } },
    },
  });
  return Object.fromEntries(
    ids.map((id) => [
      id,
      rows
        .filter((r) => r.recordId === id)
        .map((r) => ({ ...r.file, attachmentId: r.id })),
    ]),
  );
}
