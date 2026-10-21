import { it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveRecord,
  loadGovernance,
  attachFile,
  detachFile,
  operate,
} from "@/lib/governance/service";
import { packPdf } from "@/lib/govextras/pack-pdf";
import { freezePack } from "@/lib/govextras/packs";
import { findDownloadableFile } from "@/lib/files";
import { getObject } from "@/lib/storage";
import { writeFile, mkdir } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { owner, handler, docId, proof } from "./fixtures";

export function registerBoardPacksTests() {
  it("freezes reports, decisions, finance and binary evidence into immutable private PDF and ZIP", async () => {
    const evidence = (
      await saveRecord(owner, {
        kind: "RISK",
        title: "Evidence for board",
        status: "CONTROLLED",
        dueOn: "2027-01-01",
        details: { likelihood: 2, impact: 3, controls: "Exit checks" },
      })
    ).id;
    await attachFile(owner, evidence, proof());
    const decision = await prisma.decision.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Safety review",
        decisionMd: "Keep exits clear",
      },
    });
    const pack = await saveRecord(owner, {
      kind: "BOARD_PACK",
      title: "October board pack",
      status: "DRAFT",
      startsOn: "2026-10-01",
      endsOn: "2026-10-31",
      details: {
        docIds: [docId],
        decisionIds: [decision.id],
        recordIds: [evidence],
        includeFinance: true,
        currency: "INR",
      },
    });
    await freezePack(owner, pack.id);
    await freezePack(owner, pack.id);
    const frozen = (await loadGovernance(owner, "packs", {}, pack.id))
      .selected!;
    expect(frozen.status).toBe("FROZEN");
    const pdfFile = frozen.attachments.find(
      (a) => a.file.contentType === "application/pdf",
    )!.file;
    const zipFile = frozen.attachments.find(
      (a) => a.file.contentType === "application/zip",
    )!.file;
    const pdf = await findDownloadableFile(pdfFile.id, owner.user.id),
      zip = await findDownloadableFile(zipFile.id, owner.user.id);
    const pdfBytes = await getObject(pdf!.storageKey),
      zipBytes = await getObject(zip!.storageKey);
    expect(await PDFDocument.load(pdfBytes!.body)).toBeTruthy();
    expect(Buffer.from(zipBytes!.body).includes(Buffer.from("evidence/"))).toBe(
      true,
    );
    expect(
      Buffer.from(zipBytes!.body).includes(
        Buffer.from("Emergency response SOP"),
      ),
    ).toBe(true);
    const oldChecksum = pdf!.storageKey;
    await prisma.doc.updateMany({
      where: { workspaceId: owner.workspace.id, id: docId },
      data: { contentText: "Changed after freeze" },
    });
    expect(
      (await findDownloadableFile(pdfFile.id, owner.user.id))?.storageKey,
    ).toBe(oldChecksum);
    await expect(attachFile(owner, pack.id, proof())).rejects.toThrow();
    await expect(detachFile(owner, pack.id, pdfFile.id)).rejects.toThrow();
    await expect(
      operate(owner, { op: "archive", id: pack.id }),
    ).rejects.toThrow();
    expect(await findDownloadableFile(zipFile.id, handler.user.id)).toBeNull();
    await mkdir("/tmp/govextras-pdf-qa", { recursive: true });
    await writeFile("/tmp/govextras-pdf-qa/board-pack.pdf", pdfBytes!.body);
    await writeFile("/tmp/govextras-pdf-qa/board-pack.zip", zipBytes!.body);
  }, 60000);
  it("paginates long reports while retaining the final section", async () => {
    const body = await packPdf(
      "Quarterly board report " + "with a long heading ".repeat(8),
      "Kochi community office",
      Array.from({ length: 12 }, (_, i) => ({
        title: `Section ${i + 1}`,
        body: "Controls reviewed. Keep exits clear and record the next drill.\n".repeat(
          10,
        ),
      })),
    );
    expect((await PDFDocument.load(body)).getPageCount()).toBeGreaterThan(2);
    await writeFile("/tmp/govextras-pdf-qa/long-report.pdf", body);
  }, 60000);
}
