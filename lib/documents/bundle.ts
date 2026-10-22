import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { getObject } from "@/lib/storage";
import { documentExport } from "./export";
import { documentsAccess, DocumentsError, type DocumentsActor } from "./access";
import { zipFiles } from "@/lib/shell/zip";
export async function evidenceBundle(
  actor: DocumentsActor,
  start: string,
  end: string,
) {
  await documentsAccess(actor);
  const exported = await documentExport(actor, "json", start, end),
    manifest = JSON.parse(exported.body),
    ids = manifest.documents.map((r: { id: string }) => r.id);
  const proofIds = manifest.documents.flatMap(
    (d: {
      snapshot?: { source?: { proofFiles?: Array<{ fileId: string }> } };
    }) => d.snapshot?.source?.proofFiles?.map((f) => f.fileId) ?? [],
  );
  const files = await prisma.documentFile.findMany({
    where: {
      workspaceId: actor.workspace.id,
      OR: [{ documentId: { in: ids } }, { fileId: { in: proofIds } }],
    },
    include: { file: true },
  });
  if (
    files.length > 1000 ||
    files.reduce((n, f) => n + f.file.size, 0) > 100 * 1024 * 1024
  )
    throw new DocumentsError(
      "Shorten the evidence bundle to 1,000 files and 100 MB.",
    );
  const entries: Array<{ name: string; body: Buffer }> = [];
  for (const f of files) {
    const object = await getObject(f.file.storageKey);
    if (!object)
      throw new DocumentsError(
        "An evidence file is missing. Restore it before exporting this bundle.",
      );
    const body = Buffer.from(object.body);
    if (createHash("sha256").update(body).digest("hex") !== f.file.checksum)
      throw new DocumentsError(
        "An evidence checksum does not match. Review storage before exporting.",
      );
    entries.push({
      name: `files/${f.documentId}/${f.fileId}-${f.file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}`,
      body,
    });
  }
  const audit = await prisma.auditEvent.findMany({
    where: {
      workspaceId: actor.workspace.id,
      targetId: { in: ids },
      action: { startsWith: "documents." },
    },
    select: {
      id: true,
      action: true,
      targetId: true,
      actorId: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  entries.push({
    name: "manifest.json",
    body: Buffer.from(
      JSON.stringify(
        {
          ...manifest,
          audit,
          binaries: entries.map((e) => ({
            name: e.name,
            size: e.body.length,
            sha256: createHash("sha256").update(e.body).digest("hex"),
          })),
        },
        null,
        2,
      ),
    ),
  });
  return zipFiles(entries);
}
