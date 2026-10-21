import "server-only";
import type { FileObject } from "@prisma/client";
import { createHash } from "node:crypto";
import { getObject } from "@/lib/storage";
import { GovernanceError } from "@/lib/governance/service";

export async function collectPackEvidence(files: FileObject[]) {
  if (
    files.length > 100 ||
    files.reduce((n, f) => n + f.size, 0) > 18 * 1024 * 1024
  )
    throw new GovernanceError(
      "Choose evidence totalling at most 18 MB and 100 files for one pack.",
    );
  const entries: Array<{ name: string; body: Buffer }> = [];
  const manifestFiles = [];
  for (const f of files) {
    const object = await getObject(f.storageKey);
    if (!object)
      throw new GovernanceError(
        "A selected evidence file is unavailable. Restore it or update the pack selection.",
      );
    const body = Buffer.from(object.body),
      checksum = createHash("sha256").update(body).digest("hex"),
      name = `evidence/${f.id}-${f.filename.replace(/[^A-Za-z0-9._ -]/g, "_")}`;
    if (f.checksum && checksum !== f.checksum)
      throw new GovernanceError(
        "An evidence file failed verification. Restore the original before freezing.",
      );
    entries.push({ name, body });
    manifestFiles.push({
      id: f.id,
      name,
      checksum,
      size: body.length,
      url: `/api/files/${f.id}`,
    });
  }
  return { entries, manifestFiles };
}
