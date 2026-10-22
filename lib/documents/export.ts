import "server-only";

import { prisma } from "@/lib/db";
import { DocumentsError, documentsAccess, type DocumentsActor } from "./access";
import { donationsExport } from "./export/donations";
import { gstExport } from "./export/gst";
import { hsnExport } from "./export/hsn";
import { registerExport, seriesExport } from "./export/registers";
import { csvCell, dateSchema } from "./rules";
import { audit } from "./service";

export async function documentExport(
  actor: DocumentsActor,
  kind: string,
  start: string,
  end: string,
) {
  await documentsAccess(actor);
  dateSchema.parse(start);
  dateSchema.parse(end);
  if (end < start) throw new DocumentsError("Check the export dates.");
  const rows = await prisma.businessDocument.findMany({
    where: {
      workspaceId: actor.workspace.id,
      issuedOn: { gte: new Date(start), lte: new Date(end) },
      OR: [{ sourceType: null }, { sourceType: { not: "PAY_RUN" } }],
    },
    include: {
      allocations: true,
      payments: true,
      files: {
        include: {
          file: { select: { checksum: true, filename: true, size: true } },
        },
      },
    },
    orderBy: [{ issuedOn: "asc" }, { number: "asc" }],
    take: 10001,
  });
  if (rows.length > 10000)
    throw new DocumentsError("Shorten the export to at most 10,000 documents.");
  await audit(actor, `export_${kind}`, "register");
  if (kind === "filings") {
    const batches = await prisma.documentReference.findMany({
      where: { workspaceId: actor.workspace.id, kind: "FILING_BATCH" },
      orderBy: { createdAt: "desc" },
      take: 1000,
    });
    return {
      type: "application/json",
      name: "filing-batches.json",
      body: JSON.stringify({ version: 1, batches }, null, 2),
    };
  }
  if (kind === "json")
    return {
      type: "application/json",
      name: "documents.json",
      body: JSON.stringify(
        {
          version: 1,
          preparedAt: new Date().toISOString(),
          start,
          end,
          documents: rows,
        },
        null,
        2,
      ),
    };
  let header: string[],
    data: unknown[][];
  if (kind === "register") {
    ({ header, data } = await registerExport(actor, rows));
  } else if (kind === "hsn") {
    ({ header, data } = hsnExport(rows));
  } else if (["gst", "tax"].includes(kind)) {
    ({ header, data } = await gstExport(actor, rows, start, end));
  } else if (kind === "donations") {
    ({ header, data } = donationsExport(rows));
  } else if (kind === "series") {
    ({ header, data } = await seriesExport(actor, rows));
  } else throw new DocumentsError("Choose an available export.");
  return {
    type: "text/csv; charset=utf-8",
    name: `documents-${kind}.csv`,
    body: [header, ...data]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n"),
  };
}
