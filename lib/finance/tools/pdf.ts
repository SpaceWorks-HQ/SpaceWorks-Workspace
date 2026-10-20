import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { prisma } from "@/lib/db";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import {
  auditPayView,
  financeAccess,
  FinanceError,
  lockFinance,
  unavailable,
  type FinanceActor,
} from "./access";
import { payTotals } from "@/lib/finance/tools-rules";
import { currencyMinorDigits } from "@/lib/format/money";
import { recordAuditEvent } from "@/lib/audit";

/** Printable assets use the same Gilroy font and Space Works brand as the app. */
const ink = rgb(20 / 255, 44 / 255, 42 / 255),
  teal = rgb(0, 110 / 255, 99 / 255),
  cream = rgb(1, 244 / 255, 232 / 255);
export type PayslipData = {
  workspaceName: string;
  person: string;
  month: string;
  currency: string;
  kind: string;
  status: string;
  grossMinor: number;
  allowancesMinor: number;
  pfMinor: number;
  esiMinor: number;
  ptMinor: number;
  tdsMinor: number;
  advancesMinor: number;
  otherMinor: number;
  paidOn: string | null;
  reference: string | null;
};
const characterSets = new WeakMap<PDFFont, Set<number>>();
function clean(font: PDFFont, text: string) {
  const supported = characterSets.get(font) ?? new Set(font.getCharacterSet());
  characterSets.set(font, supported);
  return [...text.replace(/[\r\n\t]/g, " ")]
    .map((c) => (supported.has(c.codePointAt(0)!) ? c : "?"))
    .join("");
}
function textLines(font: PDFFont, text: string, width: number, size: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of clean(font, text).split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
    while (font.widthOfTextAtSize(line, size) > width) {
      let n = line.length - 1;
      while (n > 1 && font.widthOfTextAtSize(line.slice(0, n), size) > width)
        n--;
      lines.push(line.slice(0, n));
      line = line.slice(n);
    }
  }
  if (line) lines.push(line);
  return lines;
}
function wrapped(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  width: number,
  size = 12,
) {
  for (const line of textLines(font, text, width, size)) {
    page.drawText(line, { x, y, font, size, color: ink });
    y -= 18;
  }
  return y - 4;
}
export async function makePayslipPdf(data: PayslipData) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([
    readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-Regular.woff"),
    ),
    readFile(path.join(process.cwd(), "public/brand/fonts/Gilroy-Bold.woff")),
  ]);
  const font = await doc.embedFont(regular, { features: { liga: false } }),
    strong = await doc.embedFont(bold, { features: { liga: false } });
  const page = doc.addPage([595.28, 841.89]);
  page.drawRectangle({
    x: 0,
    y: 730,
    width: 595.28,
    height: 112,
    color: cream,
  });
  wrapped(page, strong, "Space Works", 44, 795, 510, 15);
  wrapped(page, strong, "Payslip", 44, 758, 510, 25);
  let y = 695;
  y = wrapped(page, strong, data.workspaceName, 44, y, 510, 15);
  y = wrapped(page, font, `${data.person} | ${data.month}`, 44, y - 5, 510, 14);
  y = wrapped(page, font, `${data.kind} | ${data.status}`, 44, y, 510, 11);
  const money = (n: number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: data.currency,
      currencyDisplay: "code",
    })
      .format(n / 10 ** currencyMinorDigits(data.currency))
      .replace(/\u00a0/g, " ");
  const rows: [string, number][] = [
    ["Gross pay", data.grossMinor],
    ["Allowances", data.allowancesMinor],
    ["Provident fund", -data.pfMinor],
    ["ESI", -data.esiMinor],
    ["Professional tax", -data.ptMinor],
    ["TDS", -data.tdsMinor],
    ["Advances recovered", -data.advancesMinor],
    ["Other deductions", -data.otherMinor],
  ];
  y -= 10;
  for (const [name, value] of rows) {
    page.drawLine({
      start: { x: 44, y: y - 10 },
      end: { x: 551, y: y - 10 },
      thickness: 0.5,
      color: cream,
    });
    page.drawText(name, { x: 44, y, font, size: 12, color: ink });
    const amount = clean(font, money(value));
    page.drawText(amount, {
      x: 551 - font.widthOfTextAtSize(amount, 12),
      y,
      font,
      size: 12,
      color: ink,
    });
    y -= 33;
  }
  const { netMinor } = payTotals(data);
  page.drawRectangle({
    x: 44,
    y: y - 20,
    width: 507,
    height: 48,
    color: cream,
  });
  page.drawText("Net pay", {
    x: 57,
    y: y - 2,
    font: strong,
    size: 14,
    color: teal,
  });
  const net = clean(strong, money(netMinor));
  page.drawText(net, {
    x: 538 - strong.widthOfTextAtSize(net, 16),
    y: y - 2,
    font: strong,
    size: 16,
    color: ink,
  });
  y -= 58;
  y = wrapped(
    page,
    font,
    `Paid on: ${data.paidOn ?? "Not paid"}`,
    44,
    y,
    507,
    11,
  );
  y = wrapped(
    page,
    font,
    `Payment reference: ${data.reference ?? "Not recorded"}`,
    44,
    y,
    507,
    11,
  );
  wrapped(
    page,
    font,
    "Manually recorded by the team. Retain with your payment records.",
    44,
    Math.min(y - 10, 135),
    507,
    10,
  );
  page.drawText("Private payroll record", {
    x: 44,
    y: 44,
    font,
    size: 10,
    color: ink,
  });
  page.drawText("1 / 1", { x: 523, y: 44, font, size: 10, color: ink });
  doc.setTitle(`Payslip ${data.month}`);
  doc.setProducer("Space Works Workspace");
  return Buffer.from(await doc.save());
}

export async function generatePayslip(actor: FinanceActor, runId: string) {
  await financeAccess(actor, "PAY_VIEW");
  let key: string | null = null;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await lockFinance(tx, actor.workspace.id);
        await financeAccess(actor, "PAY_VIEW", tx);
        const run = await tx.financePayRun.findFirst({
          where: { workspaceId: actor.workspace.id, id: runId },
          include: { profile: true },
        });
        if (!run) throw new FinanceError(unavailable);
        await auditPayView(actor, "pay_run", run.id, tx);
        const existing = await tx.financeAttachment.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            recordType: "PAY_RUN",
            recordId: run.id,
            file: { filename: `payslip-${run.month}.pdf`, deletedAt: null },
          },
          select: { fileId: true },
        });
        if (existing && run.status === "PAID") return existing.fileId;
        if (run.status !== "PAID")
          throw new FinanceError(
            "Record payment before generating the final payslip.",
          );
        const body = await makePayslipPdf({
          ...run,
          workspaceName: actor.workspace.name,
          person: run.profile.name,
          kind: run.profile.kind,
          paidOn: run.paidOn?.toISOString().slice(0, 10) ?? null,
        });
        const upload = await uploadWorkspaceFile({
          workspaceId: actor.workspace.id,
          uploadedById: actor.user.id,
          file: new File([new Uint8Array(body)], `payslip-${run.month}.pdf`, {
            type: "application/pdf",
          }),
          folder: "/finance-tools/pay-run",
          allowedTypes: new Set(["application/pdf"]),
          client: tx,
        });
        if (!upload.ok) throw new FinanceError(upload.error);
        key = upload.file.storageKey;
        await tx.financeAttachment.create({
          data: {
            workspaceId: actor.workspace.id,
            recordType: "PAY_RUN",
            recordId: run.id,
            fileId: upload.file.id,
            uploadedById: actor.user.id,
          },
        });
        await recordAuditEvent({
          action: "finance.payslip_generated",
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          targetType: "pay_run",
          targetId: run.id,
          client: tx,
        });
        return upload.file.id;
      },
      { timeout: 30000 },
    );
  } catch (e) {
    if (key) await deleteObjects([key]).catch(() => undefined);
    throw e;
  }
}

export async function makeReportPdf(data: {
  workspaceName: string;
  title: string;
  subtitle: string;
  sections: Array<{ title: string; rows: string[][] }>;
}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-Regular.woff"),
    ),
    { features: { liga: false } },
  );
  const strong = await doc.embedFont(
    await readFile(
      path.join(process.cwd(), "public/brand/fonts/Gilroy-Bold.woff"),
    ),
    { features: { liga: false } },
  );
  let page: PDFPage,
    y = 0;
  const next = () => {
    page = doc.addPage([595.28, 841.89]);
    page.drawRectangle({
      x: 0,
      y: 745,
      width: 595.28,
      height: 97,
      color: cream,
    });
    wrapped(page, strong, "Space Works", 44, 799, 507, 13);
    wrapped(page, strong, data.title, 44, 770, 507, 21);
    y = 714;
    y = wrapped(page, strong, data.workspaceName, 44, y, 507, 12);
    y = wrapped(page, font, data.subtitle, 44, y, 507, 10) - 12;
  };
  next();
  for (const section of data.sections) {
    if (y < 150) next();
    y = wrapped(page!, strong, section.title, 44, y, 507, 14) - 6;
    for (const row of section.rows) {
      const text = row.join("  |  ");
      // A long variance note or receipt list can span pages without clipping.
      const lines = textLines(font, text, 507, 10);
      if (lines.length * 16 + 8 < 540 && y - lines.length * 16 - 8 < 65) next();
      for (const line of lines) {
        if (y < 70) next();
        page!.drawText(line, { x: 44, y, font, size: 10, color: ink });
        y -= 16;
      }
      y -= 12;
    }
    y -= 16;
  }
  for (const [index, p] of doc.getPages().entries()) {
    p.drawText("Private finance report", {
      x: 44,
      y: 36,
      font,
      size: 9,
      color: ink,
    });
    p.drawText(`${index + 1} / ${doc.getPageCount()}`, {
      x: 510,
      y: 36,
      font,
      size: 9,
      color: ink,
    });
  }
  doc.setTitle(data.title);
  doc.setProducer("Space Works Workspace");
  return Buffer.from(await doc.save());
}
