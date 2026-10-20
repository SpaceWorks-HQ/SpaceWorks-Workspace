import "server-only";
import { prisma } from "@/lib/db";
import { currencyMinorDigits } from "@/lib/format/money";
import { uploadWorkspaceFile, deleteObjects } from "@/lib/storage";
import { recordAuditEvent } from "@/lib/audit";
import { financeReports, type FinanceQuery } from "./queries";
import { financeAccess, FinanceError, type FinanceActor } from "./access";
import { MONTH_STEPS } from "./close";
import { makeReportPdf } from "./pdf";
export async function generateReportPdf(
  actor: FinanceActor,
  query: FinanceQuery,
) {
  await financeAccess(actor, "MANAGE");
  const data = await financeReports(actor, query);
  if (data.entries.length > 2000)
    throw new FinanceError(
      "Choose a shorter period for the PDF, up to 2,000 entries. CSV supports 20,000.",
    );
  const c = data.period.currency,
    m = (v: number) =>
      new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: c,
        currencyDisplay: "code",
      }).format(v / 10 ** currencyMinorDigits(c));
  const group = (rows: typeof data.centres) =>
    rows.map((r) => [
      r.name,
      `In ${m(r.incomeMinor)}`,
      `Out ${m(r.expenseMinor)}`,
      `Net ${m(r.netMinor)}`,
    ]);
  const sections = [
    { title: "Income by source", rows: group(data.incomeBySource) },
    { title: "Income by donor or funder", rows: group(data.incomeByFunder) },
    { title: "Spending by category", rows: group(data.spendingByCategory) },
    { title: "Spending by vendor", rows: group(data.spendingByVendor) },
    { title: "Cost centre statements", rows: group(data.centres) },
    { title: "Monthly cash flow", rows: group(data.monthly) },
    {
      title: "Budget and actual",
      rows: data.budgets.map((b) => [
        b.name,
        `Budget ${m(b.amountMinor)}`,
        `Actual ${m(b.actualMinor)}`,
        b.varianceNote ?? "No variance note",
      ]),
    },
    {
      title: "Entries and private receipt references",
      rows: data.entries.map((e) => [
        e.occurredOn.toISOString().slice(0, 10),
        e.description,
        e.counterparty ?? "",
        e.kind,
        m(e.amountMinor),
        e.costCentre?.name ?? "No cost centre",
        ...e.receipts.map((f) => `Receipt: ${f.filename} (/api/files/${f.id})`),
      ]),
    },
  ];
  const body = await makeReportPdf({
    workspaceName: actor.workspace.name,
    title: "Finance report",
    subtitle: `${data.period.from} to ${data.period.to} | ${c} | Payroll details are in the pay register.`,
    sections,
  });
  let key: string | null = null;
  try {
    return await prisma.$transaction(
      async (tx) => {
        await financeAccess(actor, "MANAGE", tx);
        const month = await tx.financeMonth.upsert({
          where: {
            workspaceId_month: {
              workspaceId: actor.workspace.id,
              month: data.period.to.slice(0, 7),
            },
          },
          create: {
            workspaceId: actor.workspace.id,
            month: data.period.to.slice(0, 7),
          },
          update: {},
        });
        if (
          !(await tx.financeMonthStep.count({
            where: { workspaceId: actor.workspace.id, monthId: month.id },
          }))
        )
          await tx.financeMonthStep.createMany({
            data: MONTH_STEPS.map((title) => ({
              workspaceId: actor.workspace.id,
              monthId: month.id,
              title,
              ownerId: actor.user.id,
            })),
          });
        const filename = `finance-report-${data.period.from}-${data.period.to}.pdf`;
        const upload = await uploadWorkspaceFile({
          workspaceId: actor.workspace.id,
          uploadedById: actor.user.id,
          file: new File([new Uint8Array(body)], filename, {
            type: "application/pdf",
          }),
          folder: "/finance-tools/month",
          allowedTypes: new Set(["application/pdf"]),
          client: tx,
        });
        if (!upload.ok) throw new FinanceError(upload.error);
        key = upload.file.storageKey;
        await tx.financeAttachment.create({
          data: {
            workspaceId: actor.workspace.id,
            recordType: "MONTH",
            recordId: month.id,
            fileId: upload.file.id,
            uploadedById: actor.user.id,
          },
        });
        await recordAuditEvent({
          workspaceId: actor.workspace.id,
          actorId: actor.user.id,
          action: "finance.report_pdf_generated",
          targetType: "month",
          targetId: month.id,
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
