import "server-only";
// Page loaders for the finance tool screens. Each runs its access checks and
// returns plain data; the screens only render it.
import { prisma } from "@/lib/db";
import type { AttachmentType } from "@/lib/finance/tools-rules";
import { financeAccess, type FinanceActor } from "./access";
import {
  financePickers,
  financeReports,
  payrollData,
  spendingReview,
  toolLists,
  type FinanceQuery,
  type ToolSection,
} from "./queries";

export type AttachedFileMap = Record<
  string,
  Array<{
    id: string;
    filename: string;
    contentType: string;
    attachmentId: string;
  }>
>;

/** Live attachments of one record type, keyed by record id. */
async function attachedFiles(
  actor: FinanceActor,
  type: AttachmentType,
  ids: string[],
): Promise<AttachedFileMap> {
  if (!ids.length) return {};
  const rows = await prisma.financeAttachment.findMany({
    where: {
      workspaceId: actor.workspace.id,
      recordType: type,
      recordId: { in: ids },
      file: { deletedAt: null },
    },
    select: {
      id: true,
      recordId: true,
      file: { select: { id: true, filename: true, contentType: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const files: AttachedFileMap = {};
  for (const r of rows)
    (files[r.recordId] ??= []).push({ ...r.file, attachmentId: r.id });
  return files;
}

export async function financeToolView(
  actor: FinanceActor,
  section: Extract<
    ToolSection,
    "funds" | "budgets" | "bills" | "close" | "disbursements"
  >,
  query: FinanceQuery,
) {
  const [data, pickers] = await Promise.all([
    toolLists(actor, section, query),
    financePickers(actor),
  ]);
  const files =
    section === "funds"
      ? await attachedFiles(
          actor,
          "FUND",
          data.funds.map((f) => f.id),
        )
      : section === "bills"
        ? await attachedFiles(
            actor,
            "BILL",
            data.bills.map((b) => b.id),
          )
        : section === "disbursements"
          ? await attachedFiles(
              actor,
              "DISBURSEMENT",
              data.disbursements.map((d) => d.id),
            )
          : section === "close" && data.month
            ? await attachedFiles(actor, "MONTH", [data.month.id])
            : {};
  return { data, pickers, files };
}
export type FinanceToolView = Awaited<ReturnType<typeof financeToolView>>;

export async function payrollView(actor: FinanceActor, query: FinanceQuery) {
  const grant = await prisma.financePayrollGrant.findUnique({
    where: {
      workspaceId_userId: {
        workspaceId: actor.workspace.id,
        userId: actor.user.id,
      },
    },
  });
  const isOwner = actor.membership.role === "OWNER";
  if (!grant && !isOwner) await financeAccess(actor, "PAY_VIEW");
  const grants = isOwner
    ? await prisma.financePayrollGrant.findMany({
        where: { workspaceId: actor.workspace.id },
        select: { userId: true, manage: true },
      })
    : [];
  const members = isOwner
    ? await prisma.membership.findMany({
        where: {
          workspaceId: actor.workspace.id,
          status: "ACTIVE",
          user: { disabledAt: null },
        },
        select: { userId: true, user: { select: { name: true } } },
      })
    : [];
  if (!grant) return { grants, members, payroll: null };
  const [data, pickers] = await Promise.all([
    payrollData(actor, query),
    financePickers(actor, true),
  ]);
  const files = {
    ...(await attachedFiles(
      actor,
      "PAY_PROFILE",
      data.profiles.map((p) => p.id),
    )),
    ...(await attachedFiles(
      actor,
      "PAY_RUN",
      data.runs.map((r) => r.id),
    )),
  };
  return { grants, members, payroll: { data, pickers, files } };
}
export type PayrollView = Awaited<ReturnType<typeof payrollView>>;

export async function financeReportsView(
  actor: FinanceActor,
  query: FinanceQuery,
  spending = false,
) {
  const review = spending ? await spendingReview(actor, query) : null;
  const [data, pickers, { member }] = await Promise.all([
    review ?? financeReports(actor, query),
    financePickers(actor),
    financeAccess(actor),
  ]);
  const manage = member.role === "OWNER" || member.role === "ADMIN";
  const files =
    manage && review
      ? await attachedFiles(
          actor,
          "LEDGER",
          review.entries.map((e) => e.id),
        )
      : {};
  return { data, pickers, manage, files };
}
export type FinanceReportsView = Awaited<ReturnType<typeof financeReportsView>>;
