import "server-only";
import { prisma } from "@/lib/db";
import {
  assertActor,
  GovernanceError,
  type Actor,
} from "@/lib/governance/service";
import { detailSchemas, LABELS, label } from "@/lib/governance/schemas";
import { recordAuditEvent } from "@/lib/audit";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import { formatMoney } from "@/lib/format/money";
import { formatDate, formatDayTime } from "@/lib/format/datetime";
import { collectPackEvidence } from "./packs/evidence";
import { packPdf } from "./pack-pdf";
import { bundleZip } from "./bundle";
import { validateExtraReferences } from "./references";

/** Freeze under a tenant lock. Retries return the same immutable artifact references. */
export async function freezePack(actor: Actor, id: string) {
  const keys: string[] = [];
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Workspace" WHERE id=${actor.workspace.id} FOR NO KEY UPDATE`;
        await assertActor(actor, tx);
        const row = await tx.governanceRecord.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id,
            kind: "BOARD_PACK",
            archivedAt: null,
          },
        });
        if (!row || !row.startsOn || !row.endsOn)
          throw new GovernanceError("Choose a board pack and period.");
        if (row.approvedAt) return { id: row.id };
        const d = detailSchemas.BOARD_PACK.parse(row.details);
        await validateExtraReferences(tx, actor, "BOARD_PACK", d);
        const workspace = await tx.workspace.findFirstOrThrow({
          where: { id: actor.workspace.id },
          select: { name: true },
        });
        const [
          docs,
          decisions,
          records,
          evidence,
          packEvidence,
          docFiles,
          ledger,
        ] = await Promise.all([
          tx.doc.findMany({
            where: {
              workspaceId: actor.workspace.id,
              id: { in: d.docIds },
              archivedAt: null,
            },
            select: {
              id: true,
              title: true,
              contentText: true,
              contentHtml: true,
              updatedAt: true,
            },
          }),
          tx.decision.findMany({
            where: {
              workspaceId: actor.workspace.id,
              id: { in: d.decisionIds },
            },
            select: {
              id: true,
              title: true,
              decisionMd: true,
              contextMd: true,
              status: true,
              decidedAt: true,
            },
          }),
          tx.governanceRecord.findMany({
            where: {
              workspaceId: actor.workspace.id,
              id: { in: d.recordIds },
              archivedAt: null,
            },
            select: {
              id: true,
              kind: true,
              title: true,
              status: true,
              dueOn: true,
              notes: true,
              details: true,
              updatedAt: true,
            },
          }),
          tx.governanceAttachment.findMany({
            where: {
              workspaceId: actor.workspace.id,
              recordId: { in: d.recordIds },
              file: { deletedAt: null },
            },
            include: { file: true },
          }),
          tx.governanceAttachment.findMany({
            where: {
              workspaceId: actor.workspace.id,
              recordId: row.id,
              file: { deletedAt: null },
            },
            include: { file: true },
          }),
          tx.fileObject.findMany({
            where: {
              workspaceId: actor.workspace.id,
              docId: { in: d.docIds },
              deletedAt: null,
            },
          }),
          d.includeFinance
            ? tx.ledgerEntry.groupBy({
                by: ["currency", "kind"],
                where: {
                  workspaceId: actor.workspace.id,
                  voidedAt: null,
                  privatePayroll: false,
                  currency: d.currency,
                  occurredOn: { gte: row.startsOn, lte: row.endsOn },
                },
                _sum: { amountMinor: true },
                _count: true,
              })
            : [],
        ]);
        const files = [
          ...new Map(
            [
              ...evidence,
              ...packEvidence,
              ...docFiles.map((file) => ({ fileId: file.id, file })),
            ].map((a) => [a.fileId, a.file]),
          ).values(),
        ];
        const { entries, manifestFiles } = await collectPackEvidence(files);
        const frozenAt = new Date();
        const snapshot = {
          version: 1,
          title: row.title,
          notes: row.notes,
          workspace: workspace.name,
          from: row.startsOn.toISOString().slice(0, 10),
          to: row.endsOn.toISOString().slice(0, 10),
          frozenAt: frozenAt.toISOString(),
          frozenById: actor.user.id,
          docs,
          decisions,
          records,
          finance: ledger.map((r) => ({
            currency: r.currency,
            kind: r.kind,
            amountMinor: r._sum.amountMinor ?? 0,
            count: r._count,
          })),
          files: manifestFiles,
        };
        const sections = [
          { title: "Pack notes", body: row.notes || "No additional notes." },
          ...docs.map((d) => ({
            title: `Report: ${d.title}`,
            body: d.contentText,
          })),
          ...decisions.map((d) => ({
            title: `Decision: ${d.title}`,
            body: `${d.status}\n${d.contextMd ?? ""}\n${d.decisionMd}`,
          })),
          ...records.map((r) => ({
            title: `${LABELS[r.kind]}: ${r.title}`,
            body: `${label(r.status)}\n${r.notes}\n${Object.entries(
              r.details as Record<string, unknown>,
            )
              .filter(([k]) => !k.endsWith("Id") && !k.endsWith("Ids"))
              .map(
                ([k, v]) =>
                  `${label(k.replace(/([A-Z])/g, " $1"))}: ${String(v)}`,
              )
              .join("\n")}`,
          })),
          {
            title: "Finance summary",
            body: d.includeFinance
              ? snapshot.finance
                  .map(
                    (f) =>
                      `${f.currency} | ${f.kind} | ${formatMoney(f.amountMinor, f.currency)} | ${f.count} entries`,
                  )
                  .join("\n") +
                "\nIndividual payroll postings excluded. This is a selected summary, not the full accounts."
              : "Not selected.",
          },
          {
            title: "Evidence manifest",
            body:
              manifestFiles
                .map((f) => `${f.name}\nSHA-256 ${f.checksum}\n${f.url}`)
                .join("\n\n") || "No evidence selected.",
          },
        ];
        if (sections.reduce((n, s) => n + s.body.length, 0) > 200000)
          throw new GovernanceError(
            "Choose shorter reports for one pack, up to 200,000 characters in total.",
          );
        const pdf = await packPdf(
          row.title,
          `${workspace.name}\n${formatDate(row.startsOn, "UTC")} to ${formatDate(row.endsOn, "UTC")}\nFrozen ${formatDayTime(frozenAt, actor.workspace.timezone)}`,
          sections,
        );
        entries.unshift(
          { name: "board-pack.pdf", body: pdf },
          {
            name: "manifest.json",
            body: Buffer.from(JSON.stringify(snapshot, null, 2)),
          },
        );
        const bundle = bundleZip(entries);
        if (bundle.length > 25 * 1024 * 1024)
          throw new GovernanceError(
            "The pack is too large. Choose fewer reports or evidence files.",
          );
        for (const [filename, body, type] of [
          ["board-pack.pdf", pdf, "application/pdf"],
          ["board-pack.zip", bundle, "application/zip"],
        ] as const) {
          const uploaded = await uploadWorkspaceFile({
            workspaceId: actor.workspace.id,
            uploadedById: actor.user.id,
            file: new File([new Uint8Array(body)], filename, { type }),
            folder: "/governance/packs",
            client: tx,
          });
          if (!uploaded.ok) throw new GovernanceError(uploaded.error);
          keys.push(uploaded.file.storageKey);
          await tx.governanceAttachment.create({
            data: {
              workspaceId: actor.workspace.id,
              recordId: row.id,
              fileId: uploaded.file.id,
            },
          });
        }
        await tx.governanceRecord.update({
          where: {
            workspaceId_id: { workspaceId: actor.workspace.id, id: row.id },
          },
          data: {
            status: "FROZEN",
            approvedAt: frozenAt,
            approvedById: actor.user.id,
          },
        });
        await recordAuditEvent({
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          action: "governance.pack_frozen",
          targetType: "governance",
          targetId: row.id,
          client: tx,
        });
        return { id: row.id };
      },
      { timeout: 60000 },
    );
  } catch (e) {
    if (keys.length) await deleteObjects(keys).catch(() => undefined);
    throw e;
  }
}
