import "server-only";

import { prisma } from "@/lib/db";
import { CHAT_FOLDER, fileKind, type FileKind } from "@/lib/files/versions";

import { NOT_CHAT } from "./access";

// ───────────── Reads ─────────────

export type UsageSummary = { files: number; bytes: number; versionBytes: number; trashBytes: number; byKind: Array<{ kind: FileKind; files: number; bytes: number }> };

/**
 * Storage used by the workspace's files (library, docs and other areas), with
 * older versions and the trash shown apart. Chat attachments are left out:
 * they belong to chat and never appear in the library.
 */
export async function usageSummary(workspaceId: string): Promise<UsageSummary> {
  const [live, trash, byType, versions] = await Promise.all([
    prisma.fileObject.aggregate({ where: { workspaceId, deletedAt: null, ...NOT_CHAT }, _sum: { size: true }, _count: true }),
    prisma.fileObject.aggregate({ where: { workspaceId, deletedAt: { not: null }, ...NOT_CHAT }, _sum: { size: true } }),
    prisma.fileObject.groupBy({ by: ["contentType"], where: { workspaceId, deletedAt: null, ...NOT_CHAT }, _sum: { size: true }, _count: true }),
    prisma.$queryRaw<{ bytes: bigint | null }[]>`
      SELECT SUM(v."size")::bigint AS bytes FROM "FileVersion" v JOIN "FileObject" f ON f."id" = v."fileId"
      WHERE f."workspaceId" = ${workspaceId} AND v."version" <> f."currentVersion"
        AND f."folder" NOT LIKE '/org-people%'
        AND f."folder" <> '/people-service' AND f."folder" NOT LIKE '/people-service/%'
        AND f."folder" <> ${CHAT_FOLDER} AND f."folder" NOT LIKE ${`${CHAT_FOLDER}/%`}
        AND NOT EXISTS (SELECT 1 FROM "MessageAttachment" a WHERE a."fileId" = f."id")`,
  ]);
  const kinds = new Map<FileKind, { files: number; bytes: number }>();
  for (const row of byType) {
    const kind = fileKind(row.contentType);
    const entry = kinds.get(kind) ?? { files: 0, bytes: 0 };
    entry.files += row._count;
    entry.bytes += row._sum.size ?? 0;
    kinds.set(kind, entry);
  }
  return {
    files: live._count,
    bytes: live._sum.size ?? 0,
    versionBytes: Number(versions[0]?.bytes ?? 0),
    trashBytes: trash._sum.size ?? 0,
    byKind: [...kinds.entries()].map(([kind, value]) => ({ kind, ...value })).sort((a, b) => b.bytes - a.bytes),
  };
}
