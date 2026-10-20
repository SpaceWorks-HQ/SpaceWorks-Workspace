import "server-only";
import { prisma } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import { formatDate } from "@/lib/format/datetime";
import { audit, ensure, lock, type Actor } from "./service";
import { object } from "./analytics";
import { createFundingPdf } from "./pdf";

/** Save the report snapshot beside its programme, using the same private proof permissions. */
export async function generateImpactReport(actor: Actor, recordId: string) {
  let storageKey: string | undefined;
  try {
    return await prisma.$transaction(async tx => {
      await lock(actor, tx);
      const workspaceId = actor.workspace.id;
      const programme = await tx.fundingRecord.findFirst({ where: { workspaceId, id: recordId, kind: "PROGRAMME", archivedAt: null } });
      ensure(programme);
      const kpis = await tx.fundingRecord.findMany({ where: { workspaceId, parentId: programme.id, kind: "KPI", archivedAt: null }, include: { children: { where: { workspaceId, kind: "IMPACT_ENTRY", archivedAt: null }, orderBy: [{ dateOn: "desc" }, { id: "asc" }] } }, orderBy: { title: "asc" } });
      const workspace = await tx.workspace.findFirstOrThrow({ where: { id: workspaceId }, select: { name: true } });
      const paragraphs = [workspace.name, `Prepared ${formatDate(new Date(), actor.workspace.timezone)} from manual programme records.`, String(object(programme.details).purpose ?? "")];
      for (const kpi of kpis) {
        const d = object(kpi.details);
        const total = d.aggregation === "LATEST" ? Number(object(kpi.children[0]?.details).value ?? 0) : kpi.children.reduce((sum, e) => sum + Number(object(e.details).value ?? 0), 0);
        paragraphs.push(`${kpi.title}: ${total} / ${d.target} ${d.unit}`);
        for (const entry of kpi.children) paragraphs.push(`${entry.dateOn ? formatDate(entry.dateOn, "UTC") : ""} · ${object(entry.details).period}: ${object(entry.details).value} ${d.unit}\n${entry.notes}`);
      }
      const body = await createFundingPdf(`${programme.title} · Impact report`, paragraphs);
      ensure(await tx.fundingAttachment.count({ where: { workspaceId, recordId, file: { deletedAt: null } } }) < 20, "Remove an unused attachment to make space for the report.");
      const uploaded = await uploadWorkspaceFile({ workspaceId, uploadedById: actor.user.id, folder: "/funding", file: new File([new Uint8Array(body)], "impact-report.pdf", { type: "application/pdf" }), client: tx });
      ensure(uploaded.ok, uploaded.ok ? "" : uploaded.error); storageKey = uploaded.file.storageKey;
      await tx.fundingAttachment.create({ data: { workspaceId, recordId, fileId: uploaded.file.id, generated: true } });
      await audit(actor, tx, programme, "impact_report_generated");
      return { id: programme.id };
    }, { timeout: 30000 });
  } catch (error) { if (storageKey) await deleteObjects([storageKey]).catch(() => undefined); throw error; }
}
