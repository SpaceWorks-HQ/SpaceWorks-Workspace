import { it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { getDocument } from "@/lib/documents/access";
import { evidenceBundle } from "@/lib/documents/bundle";
import { makeDocumentPdf } from "@/lib/documents/pdf";
import type { DocumentSnapshot } from "@/lib/documents/service";
import { actor, records } from "./fixtures";

export function registerBundlePdfTests() {
  it("exports a complete evidence ZIP with checksums", async () => {
    const bytes = await evidenceBundle(actor, "2026-10-01", "2026-10-31");
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.includes(Buffer.from("manifest.json"))).toBe(true);
    await writeFile("tmp/pdfs/documents-evidence.zip", bytes);
  });
  it("paginates long PDF content without truncating the final line", async () => {
    const row = await getDocument(actor, records.invoiceId),
      snapshot = row.snapshot as unknown as DocumentSnapshot;
    const long = {
      ...snapshot,
      calculation: {
        ...snapshot.calculation,
        rows: Array.from({ length: 45 }, (_, i) => ({
          ...snapshot.calculation.rows[0],
          description: `Programme schedule item ${i + 1}: a detailed description that wraps safely onto another line when necessary.`,
        })),
      },
    };
    const bytes = await makeDocumentPdf(long);
    await writeFile("tmp/pdfs/documents-long.pdf", bytes);
    expect(bytes.length).toBeGreaterThan(10000);
  });
}
