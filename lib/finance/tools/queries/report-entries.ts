import "server-only";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { dateOnly } from "@/lib/finance/dates";
import { canManageFinance } from "@/lib/roles";
import {
  FinanceError,
  financeAccess,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import {
  toolPeriod,
  type FinanceQuery,
} from "./period";

export async function reportEntries(actor: FinanceActor, query: FinanceQuery) {
  const access = await financeAccess(actor);
  const p = toolPeriod(actor, query);
  const where: Prisma.LedgerEntryWhereInput = {
    workspaceId: actor.workspace.id,
    voidedAt: null,
    currency: p.currency,
    occurredOn: { gte: dateOnly(p.from), lte: dateOnly(p.to) },
    ...(query.centre ? { costCentreId: query.centre } : {}),
    privatePayroll: false,
    ...(query.q
      ? {
          OR: [
            {
              description: {
                contains: query.q.slice(0, 120),
                mode: "insensitive",
              },
            },
            {
              counterparty: {
                contains: query.q.slice(0, 120),
                mode: "insensitive",
              },
            },
          ],
        }
      : {}),
  };
  const entries = await prisma.ledgerEntry.findMany({
    where,
    orderBy: [{ occurredOn: "asc" }, { id: "asc" }],
    take: 20001,
    include: {
      category: { select: { name: true } },
      costCentre: { select: { name: true } },
      fund: { select: { name: true } },
      account: { select: { name: true } },
      receiptFile: { select: { id: true, filename: true, deletedAt: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (entries.length > 20000)
    throw new FinanceError(
      "This period has more than 20,000 entries. Choose a shorter period.",
    );
  const payments = await prisma.financeBillPayment.findMany({
    where: {
      workspaceId: actor.workspace.id,
      id: {
        in: entries
          .filter((e) => e.sourceType === "finance_bill_payment")
          .map((e) => e.sourceId!),
      },
    },
    select: { id: true, billId: true },
  });
  const billId = new Map(payments.map((p) => [p.id, p.billId]));
  const [attachments, purchases, claims] = await Promise.all([
    prisma.financeAttachment.findMany({
      where: {
        workspaceId: actor.workspace.id,
        OR: [
          { recordType: "LEDGER", recordId: { in: entries.map((e) => e.id) } },
          {
            recordType: "BILL",
            recordId: { in: payments.map((p) => p.billId) },
          },
          {
            recordType: "DISBURSEMENT",
            recordId: {
              in: entries
                .filter((e) => e.sourceType === "finance_disbursement")
                .map((e) => e.sourceId!),
            },
          },
        ],
        file: { deletedAt: null },
      },
      select: {
        recordType: true,
        recordId: true,
        file: { select: { id: true, filename: true, contentType: true } },
      },
    }),
    prisma.purchaseRequest.findMany({
      where: {
        workspaceId: actor.workspace.id,
        id: {
          in: entries
            .filter((e) => e.sourceType === "purchase_request")
            .map((e) => e.sourceId!),
        },
      },
      select: { id: true, fileIds: true, requesterId: true },
    }),
    prisma.reimbursement.findMany({
      where: {
        workspaceId: actor.workspace.id,
        id: {
          in: entries
            .filter((e) => e.sourceType === "reimbursement")
            .map((e) => e.sourceId!),
        },
      },
      select: { id: true, receiptFileIds: true, claimantId: true },
    }),
  ]);
  const sourceFiles = new Map([
    ...purchases.map(
      (r) => [r.id, { owner: r.requesterId, ids: r.fileIds }] as const,
    ),
    ...claims.map(
      (r) => [r.id, { owner: r.claimantId, ids: r.receiptFileIds }] as const,
    ),
  ]);
  const extraFiles = await prisma.fileObject.findMany({
    where: {
      workspaceId: actor.workspace.id,
      id: { in: [...sourceFiles.values()].flatMap((r) => r.ids) },
      deletedAt: null,
    },
    select: { id: true, filename: true, contentType: true },
  });
  const extraById = new Map(extraFiles.map((f) => [f.id, f]));
  const byRecord = new Map<string, typeof extraFiles>();
  for (const a of attachments) {
    const key = `${a.recordType}:${a.recordId}`,
      files = byRecord.get(key) ?? [];
    files.push(a.file);
    byRecord.set(key, files);
  }
  const controlProofs = await prisma.moneyControlAttachment.findMany({where:{workspaceId:actor.workspace.id,recordId:{in:entries.filter(e=>["cash_voucher","asset_disposal"].includes(e.sourceType??"")).map(e=>e.sourceId!)},file:{deletedAt:null},record:{payroll:false}},select:{recordId:true,file:{select:{id:true,filename:true,contentType:true}}}});
  const receiptsFor = (e: (typeof entries)[number]) => {
    const files = [
      ...(canManageFinance(access.member) && ["cash_voucher","asset_disposal"].includes(e.sourceType??"") ? controlProofs.filter(f=>f.recordId===e.sourceId).map(f=>f.file) : []),
      ...(byRecord.get(`LEDGER:${e.id}`) ?? []),
      ...(e.sourceType === "finance_bill_payment"
        ? (byRecord.get(`BILL:${billId.get(e.sourceId!)}`) ?? [])
        : []),
      ...(e.sourceType === "finance_disbursement"
        ? (byRecord.get(`DISBURSEMENT:${e.sourceId}`) ?? [])
        : []),
    ];
    const source = e.sourceId ? sourceFiles.get(e.sourceId) : null;
    const allowed =
      !source ||
      access.member.role === "ADMIN" ||
      access.member.role === "OWNER" ||
      source.owner === actor.user.id;
    if (source && allowed)
      for (const id of source.ids) {
        const file = extraById.get(id);
        if (file) files.push(file);
      }
    if (
      allowed &&
      e.receiptFile &&
      !e.receiptFile.deletedAt &&
      !files.some((f) => f.id === e.receiptFile!.id)
    )
      files.push({ ...e.receiptFile, contentType: "application/pdf" });
    return [...new Map(files.map((f) => [f.id, f])).values()];
  };
  return {
    access,
    period: p,
    entries: entries.map((e) => ({ ...e, hasControlProof: ["cash_voucher","asset_disposal"].includes(e.sourceType??"") && controlProofs.some(f=>f.recordId===e.sourceId), receipts: receiptsFor(e) })),
  };
}
