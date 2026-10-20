import "server-only";
import { type FinancePayRun, type Prisma } from "@prisma/client";
import type { DbClient } from "@/lib/db";
import { financeAccess, type FinanceActor } from "@/lib/finance/tools/access";
import { lockDocuments } from "./access";
import { draftSchema } from "./rules";
/** Register the existing finance-generated payslip; keep a single PDF implementation and artifact. */
export async function retainPayslipDocument(
  actor: FinanceActor,
  run: FinancePayRun,
  fileId: string,
  tx: DbClient,
) {
  await financeAccess(actor, "PAY_VIEW", tx);
  await lockDocuments(tx, actor.workspace.id);
  const existing = await tx.businessDocument.findFirst({
    where: {
      workspaceId: actor.workspace.id,
      type: "PAYSLIP",
      sourceType: "PAY_RUN",
      sourceId: run.id,
    },
  });
  if (existing) return existing.id;
  const input = draftSchema.parse({
    type: "PAYSLIP",
    title: `Payslip ${run.month}`,
    currency: run.currency,
    issuedOn: (run.paidOn ?? new Date()).toISOString().slice(0, 10),
    partyName: "Payroll recipient",
    sourceType: "PAY_RUN",
    sourceId: run.id,
  });
  const profile = await tx.financePayProfile.findFirstOrThrow({
    where: { workspaceId: actor.workspace.id, id: run.profileId },
  });
  input.partyName = profile.name;
  const snapshot = {
    version: 1,
    templateVersion: "finance-payslip-2026.1",
    source: { runId: run.id, month: run.month, status: run.status },
    input,
  };
  const row = await tx.businessDocument.create({
    data: {
      workspaceId: actor.workspace.id,
      type: "PAYSLIP",
      title: input.title,
      status: "ISSUED",
      issuedOn: run.paidOn ?? new Date(),
      currency: run.currency,
      number: `PAY-${run.id}`,
      ownerId: actor.user.id,
      sourceType: "PAY_RUN",
      sourceId: run.id,
      input: JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue,
      snapshot: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
      totalMinor:
        run.grossMinor +
        run.allowancesMinor -
        run.pfMinor -
        run.esiMinor -
        run.ptMinor -
        run.tdsMinor -
        run.advancesMinor -
        run.otherMinor,
      issuedAt: new Date(),
      issuedById: actor.user.id,
    },
  });
  await tx.documentFile.create({
    data: {
      workspaceId: actor.workspace.id,
      documentId: row.id,
      kind: "PDF",
      fileId,
    },
  });
  return row.id;
}
