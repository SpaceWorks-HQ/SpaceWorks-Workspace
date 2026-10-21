import "server-only";
import { prisma } from "@/lib/db";
import { localDate } from "@/lib/finance/dates";
import { documentsAccess, getDocument, type DocumentsActor } from "../access";
import { creditsByInvoice } from "../corrections";
import { refundState } from "../refunds";
import { ageing, draftSchema, INVOICES } from "../rules";
import { audit } from "../service";
export async function listDocuments(
  actor: DocumentsActor,
  query: {
    status?: string;
    type?: string;
    q?: string;
    page?: string;
    owner?: string;
  } = {},
) {
  await documentsAccess(actor);
  const page = Math.max(1, Math.min(10000, Number(query.page) || 1));
  const where = {
    workspaceId: actor.workspace.id,
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.owner ? { ownerId: query.owner } : {}),
    ...(query.q
      ? {
          OR: [
            {
              title: {
                contains: query.q.slice(0, 200),
                mode: "insensitive" as const,
              },
            },
            {
              number: {
                contains: query.q.slice(0, 200),
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
  };
  // Payroll source records never enter the general document register.
  const rows = await prisma.businessDocument.findMany({
    where: {
      AND: [
        where,
        { OR: [{ sourceType: null }, { sourceType: { not: "PAY_RUN" } }] },
      ],
    },
    orderBy: [{ issuedOn: "desc" }, { id: "desc" }],
    skip: (page - 1) * 40,
    take: 41,
    include: {
      allocations: true,
      payments: true,
      corrections: {
        where: {
          type: { in: ["CREDIT_NOTE", "PAYMENT_REFUND", "REFUND_VOUCHER"] },
          status: "ISSUED",
        },
        select: { totalMinor: true, type: true },
      },
    },
  });
  const credits = await creditsByInvoice(actor.workspace.id),
    refunds = await refundState(actor.workspace.id);
  const today = localDate(new Date(), actor.workspace.timezone);
  return {
    page,
    more: rows.length > 40,
    rows: rows.slice(0, 40).map((row) => {
      const paid =
          row.allocations.reduce((s, a) => s + a.cashMinor + a.tdsMinor, 0) -
          (refunds.invoices.get(row.id) ?? 0),
        credited = credits.get(row.id) ?? 0,
        balance = Math.max(0, row.totalMinor - paid - credited);
      return {
        ...row,
        balance,
        paymentStatus: row.corrections.some(
          (c) => c.type === "PAYMENT_REFUND" || c.type === "REFUND_VOUCHER",
        )
          ? row.corrections
              .filter((c) => c.type !== "CREDIT_NOTE")
              .reduce((n, c) => n + c.totalMinor, 0) >= row.totalMinor
            ? "Refunded"
            : "Part refunded"
          : paid > 0
            ? balance === 0
              ? "Settled"
              : "Part paid"
            : "Unpaid",
        age:
          row.dueOn &&
          INVOICES.includes(row.type) &&
          row.status === "ISSUED" &&
          balance
            ? ageing(row.dueOn.toISOString().slice(0, 10), today)
            : null,
      };
    }),
  };
}
export async function documentDetail(actor: DocumentsActor, id: string) {
  const row = await getDocument(actor, id);
  await audit(actor, "viewed", id);
  const [files, allocations, corrections, deliveries, history] =
    await Promise.all([
      prisma.documentFile.findMany({
        where: { workspaceId: actor.workspace.id, documentId: id },
        include: {
          file: {
            select: {
              id: true,
              filename: true,
              contentType: true,
              size: true,
              checksum: true,
            },
          },
        },
      }),
      prisma.documentAllocation.findMany({
        where: {
          workspaceId: actor.workspace.id,
          OR: [{ invoiceId: id }, { receiptId: id }],
        },
        include: {
          invoice: { select: { number: true, title: true } },
          receipt: { select: { number: true, title: true } },
        },
      }),
      prisma.businessDocument.findMany({
        where: {
          workspaceId: actor.workspace.id,
          OR: [
            { parentId: id },
            {
              snapshot: {
                path: ["source", "refundAllocations"],
                array_contains: [{ invoiceId: id }],
              },
            },
            {
              snapshot: {
                path: ["source", "noteAllocations"],
                array_contains: [{ invoiceId: id }],
              },
            },
          ],
        },
        select: { id: true, number: true, title: true, status: true },
      }),
      prisma.documentDelivery.findMany({
        where: { workspaceId: actor.workspace.id, documentId: id },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      prisma.auditEvent.findMany({
        where: {
          workspaceId: actor.workspace.id,
          targetId: id,
          action: { startsWith: "documents." },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);
  const outbox = await prisma.outboxMessage.findMany({
    where: { id: { in: deliveries.map((d) => d.outboxId) } },
    select: { id: true, status: true, sentAt: true },
  });
  return {
    row,
    input: draftSchema.parse(row.input),
    files,
    allocations,
    corrections,
    deliveries: deliveries.map((d) => ({
      ...d,
      status:
        outbox.find((o) => o.id === d.outboxId)?.status ??
        "Retained delivery record",
    })),
    history,
  };
}
