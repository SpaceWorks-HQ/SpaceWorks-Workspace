import "server-only";
import { retainPayslipDocument } from "@/lib/documents/payroll";
import { prisma } from "@/lib/db";
import {
  uploadWorkspaceFile,
  deleteObjects,
} from "@/lib/storage";
import {
  auditPayView,
  financeAccess,
  FinanceError,
  lockFinance,
  unavailable,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { recordAuditEvent } from "@/lib/audit";
import { makePayslipPdf } from "./payslip";

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
        if (existing && run.status === "PAID") { await retainPayslipDocument(actor,run,existing.fileId,tx); return existing.fileId; }
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
        await retainPayslipDocument(actor,run,upload.file.id,tx);
        return upload.file.id;
      },
      { timeout: 30000 },
    );
  } catch (e) {
    if (key) await deleteObjects([key]).catch(() => undefined);
    throw e;
  }
}
