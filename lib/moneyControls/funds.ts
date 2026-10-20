import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { FinanceError } from "@/lib/finance/tools/access";
import { detailsSchemas, fundIssues, type FundCharge } from "./rules";
import { recordAuditEvent } from "@/lib/audit";

/** Commitments plus actual expenses. Derived payments replace their parent's reservation. */
export async function fundCharges(client: DbClient, workspaceId: string) {
  return client.$queryRaw<FundCharge[]>(Prisma.sql`
 SELECT 'entry' AS "sourceType", e.id AS "sourceId", e."fundId", e."amountMinor", e.currency, e."categoryId", e."occurredOn", e."privatePayroll" AS payroll,
 CASE WHEN e."invoiceNumber" IS NOT NULL AND e."invoiceNumber"<>'' THEN lower(trim(coalesce(e.counterparty,'') || ':' || e."invoiceNumber"))
 WHEN e."sourceType"='finance_payroll' THEN 'payroll:'||e."sourceId"
 WHEN e."sourceType"='finance_disbursement' THEN 'disbursement:'||e."sourceId" ELSE 'entry:'||e.id END AS "duplicateKey"
 FROM "LedgerEntry" e WHERE e."workspaceId"=${workspaceId} AND e.kind='EXPENSE' AND e."voidedAt" IS NULL AND e."fundId" IS NOT NULL
 UNION ALL
 SELECT 'bill',b.id,b."fundId",b."amountMinor"-b."paidMinor",b.currency,b."categoryId",b."issuedOn",false,lower(trim(b.vendor || ':' || b.number))
 FROM "FinanceBill" b WHERE b."workspaceId"=${workspaceId} AND b."fundId" IS NOT NULL AND b."amountMinor">b."paidMinor"
 UNION ALL
 SELECT 'pay_run',p.id,p."fundId",p."netMinor",p.currency,p."categoryId",coalesce(p."paidOn",(p.month||'-01')::date),true,'payroll:'||p.id
 FROM "FinancePayRun" p WHERE p."workspaceId"=${workspaceId} AND p."fundId" IS NOT NULL AND p."ledgerEntryId" IS NULL
 UNION ALL
 SELECT 'disbursement',d.id,d."fundId",d."amountMinor",d.currency,d."categoryId",coalesce(d."paidOn",d."dueOn",d."createdAt"::date),false,'disbursement:'||d.id
 FROM "FinanceDisbursement" d WHERE d."workspaceId"=${workspaceId} AND d."fundId" IS NOT NULL AND d."ledgerEntryId" IS NULL
 `);
}
export async function fundAssessment(client: DbClient, workspaceId: string) {
  const rules = await client.moneyControlRecord.findMany({
    where: { workspaceId, kind: "FUND_RULE", status: "ACTIVE" },
  });
  if (!rules.length) return [];
  const charges = await fundCharges(client, workspaceId);
  return rules.map((rule) => {
    const config = detailsSchemas.FUND_RULE.parse(rule.details),
      matching = charges.filter((c) => c.fundId === rule.fundId);
    const committedMinor = matching.reduce((n, c) => n + c.amountMinor, 0);
    const evaluated = matching.map((charge) => ({
      charge,
      issues: fundIssues(
        charge,
        { ...rule, fundId: rule.fundId!, details: config },
        committedMinor,
        charges.some(
          (c) =>
            c.fundId !== charge.fundId &&
            c.currency === charge.currency &&
            c.duplicateKey === charge.duplicateKey,
        ),
      ),
    }));
    return {
      rule,
      committedMinor,
      remainingMinor: rule.amountMinor - committedMinor,
      evaluated,
    };
  });
}
/** Called within the existing finance lock, after mutation and before commit. */
export async function checkFundRecord(
  client: DbClient,
  workspaceId: string,
  actorId: string,
  sourceType: string,
  sourceId: string,
) {
  if (!["entry", "bill", "pay_run", "disbursement"].includes(sourceType))
    return;
  const reports = await fundAssessment(client, workspaceId);
  for (const report of reports) {
    const current = report.evaluated.filter(
      (e) =>
        e.charge.sourceType === sourceType && e.charge.sourceId === sourceId,
    );
    // A payment consumes the same bill reservation; check its resulting ledger charge too.
    if (sourceType === "bill") {
      const payments = await client.financeBillPayment.findMany({
        where: { workspaceId, billId: sourceId },
        select: { id: true },
      });
      const entries = await client.ledgerEntry.findMany({
        where: {
          workspaceId,
          sourceType: "finance_bill_payment",
          sourceId: { in: payments.map((p) => p.id) },
        },
        select: { id: true },
      });
      current.push(
        ...report.evaluated.filter(
          (e) =>
            e.charge.sourceType === "entry" &&
            entries.some((p) => p.id === e.charge.sourceId),
        ),
      );
    } else if (["pay_run", "disbursement"].includes(sourceType)) {
      const entries = await client.ledgerEntry.findMany({
        where: {
          workspaceId,
          sourceType:
            sourceType === "pay_run"
              ? "finance_payroll"
              : "finance_disbursement",
          sourceId,
        },
        select: { id: true },
      });
      current.push(
        ...report.evaluated.filter(
          (e) =>
            e.charge.sourceType === "entry" &&
            entries.some((p) => p.id === e.charge.sourceId),
        ),
      );
    }
    for (const { issues } of current) {
      const blocked = issues.find((i) => i.mode === "BLOCK");
      if (blocked) throw new FinanceError(blocked.message);
      if (issues.length)
        await recordAuditEvent({
          workspaceId,
          actorId,
          action: "moneycontrols.fund_warning",
          targetType: "money_control",
          targetId: report.rule.id,
          metadata: {
            sourceType,
            sourceId,
            issues: issues.map((i) => i.message).join("; "),
          },
          client,
        });
    }
  }
}
export async function utilisation(workspaceId: string) {
  return prisma.ledgerEntry.groupBy({
    by: ["fundId", "categoryId", "currency", "kind"],
    where: { workspaceId, fundId: { not: null }, voidedAt: null },
    _sum: { amountMinor: true },
  });
}

/** UI warnings contain only the generic rule messages, including for private payroll coding. */
export async function fundWarningsForRecord(
  workspaceId: string,
  sourceType: string,
  sourceId: string,
) {
  const reports = await fundAssessment(prisma, workspaceId);
  const derivedIds: string[] = [];
  if (sourceType === "bill") {
    const payments = await prisma.financeBillPayment.findMany({
      where: { workspaceId, billId: sourceId },
      select: { id: true },
    });
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        workspaceId,
        sourceType: "finance_bill_payment",
        sourceId: { in: payments.map((p) => p.id) },
      },
      select: { id: true },
    });
    derivedIds.push(...entries.map((e) => e.id));
  } else if (["pay_run", "disbursement"].includes(sourceType)) {
    const entries = await prisma.ledgerEntry.findMany({
      where: {
        workspaceId,
        sourceType:
          sourceType === "pay_run" ? "finance_payroll" : "finance_disbursement",
        sourceId,
      },
      select: { id: true },
    });
    derivedIds.push(...entries.map((e) => e.id));
  }
  return [
    ...new Set(
      reports.flatMap((r) =>
        r.evaluated
          .filter(
            (e) =>
              (e.charge.sourceType === sourceType &&
                e.charge.sourceId === sourceId) ||
              (e.charge.sourceType === "entry" &&
                derivedIds.includes(e.charge.sourceId)),
          )
          .flatMap((e) =>
            e.issues.filter((i) => i.mode === "WARN").map((i) => i.message),
          ),
      ),
    ),
  ];
}
