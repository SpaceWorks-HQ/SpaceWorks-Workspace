import "server-only";
import { type DbClient } from "@/lib/db";
import { DocumentsError, getDocument, type DocumentsActor } from "../access";
import { type DraftInput } from "../rules";
import { date } from "./shared";

import type { FundingRecord } from "@prisma/client";

export async function freezeSnapshotSources(
  actor: DocumentsActor,
  v: DraftInput,
  tx: DbClient,
  fundingSource: FundingRecord | null,
  fundId: string | null,
) {
  let source: Record<string, unknown> = {};
  if (fundingSource && fundingSource.currency !== v.currency)
    source = {
      originalPayment: {
        amountMinor: fundingSource.amountMinor,
        currency: fundingSource.currency,
      },
      exchangeBasis: v.exchangeBasis,
    };
  if (fundingSource) {
    const proofs = await tx.fundingAttachment.findMany({
      where: {
        workspaceId: actor.workspace.id,
        recordId: fundingSource.id,
        file: { deletedAt: null },
      },
      include: {
        file: {
          select: {
            id: true,
            filename: true,
            checksum: true,
            contentType: true,
          },
        },
      },
    });
    source = {
      ...source,
      fundingId: fundingSource.id,
      proofFiles: proofs.map((p) => ({
        fileId: p.file.id,
        filename: p.file.filename,
        checksum: p.file.checksum,
        contentType: p.file.contentType,
      })),
    };
  }

  if (v.parentId) {
    const parent = await getDocument(actor, v.parentId, tx);
    source = {
      ...source,
      originalNumber: parent.number,
      originalDate: parent.issuedOn.toISOString().slice(0, 10),
    };
  }
  if (v.personId) {
    const person = await tx.memberProfile.findFirstOrThrow({
      where: { workspaceId: actor.workspace.id, userId: v.personId },
      include: { user: { select: { name: true } } },
    });
    source = {
      ...source,
      person: person.user.name,
      start: person.engagementStart?.toISOString().slice(0, 10),
      end: person.engagementEnd?.toISOString().slice(0, 10),
      engagementType: person.engagementType,
    };
  }
  if (fundId) {
    const entries = await tx.ledgerEntry.findMany({
      take: 2001,
      where: {
        workspaceId: actor.workspace.id,
        fundId,
        voidedAt: null,
        currency: v.currency,
        occurredOn: {
          gte: date(v.periodStart || v.issuedOn),
          lte: date(v.periodEnd || v.issuedOn),
        },
      },
      select: {
        id: true,
        kind: true,
        amountMinor: true,
        privatePayroll: true,
        occurredOn: true,
      },
    });
    if (entries.length > 2000)
      throw new DocumentsError(
        "Shorten the certificate period to at most 2,000 entries.",
      );
    source = {
      ...source,
      fundId,
      ...(fundingSource
        ? {
            grant: {
              id: fundingSource.id,
              title: fundingSource.title,
              awardMinor: fundingSource.amountMinor,
              details: fundingSource.details,
            },
          }
        : {}),
      schedule: [
        ...entries
          .filter((e) => !e.privatePayroll)
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            amountMinor: e.amountMinor,
            date: e.occurredOn.toISOString().slice(0, 10),
          })),
        ...(entries.some((e) => e.privatePayroll)
          ? [
              {
                id: "Restricted payroll total",
                kind: "EXPENSE",
                amountMinor: entries
                  .filter((e) => e.privatePayroll)
                  .reduce((n, e) => n + e.amountMinor, 0),
                date: v.periodEnd || v.issuedOn,
              },
            ]
          : []),
      ],
      incomeMinor: entries
        .filter((e) => e.kind === "INCOME")
        .reduce((s, e) => s + e.amountMinor, 0),
      expenseMinor: entries
        .filter((e) => e.kind === "EXPENSE")
        .reduce((s, e) => s + e.amountMinor, 0),
    };
    if (
      ["CSR_UC", "GOVERNMENT_UC"].includes(v.type) &&
      (source.incomeMinor !== v.receiptsMinor + v.interestMinor ||
        source.expenseMinor !== v.expenditureMinor + v.refundsMinor)
    )
      throw new DocumentsError(
        "Receipts plus interest, and expenditure plus returned funds, must match the linked fund's period schedule. Review the ledger and period.",
      );
  }
  return source;
}
