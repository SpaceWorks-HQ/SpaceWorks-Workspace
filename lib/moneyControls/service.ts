import "server-only";
import { Prisma, type MoneyControlRecord } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { recordActivity } from "@/lib/activity";
import {
  indexSearchDocument,
  removeSearchDocument,
} from "@/lib/search/documents";
import { nextWorkspaceSequence } from "@/lib/counters";
import { requestApproval } from "@/lib/approvals/engine";
import {
  assertOpen,
  FinanceError,
  lockFinance,
  validateMember,
  validateTags,
} from "@/lib/finance/tools/access";
import { financeNote } from "@/lib/finance/tools/service";
import { accountBalance } from "@/lib/finance/tools/close";
import { lockAsset } from "@/lib/approvals/ops";
import { formatDate } from "@/lib/format/datetime";
import {
  controlsAccess,
  controlRecord,
  details,
  type ControlsActor,
} from "./access";
import {
  countDenominations,
  detailsSchemas,
  fiscalQuarter,
  fiscalYear,
  recordSchema,
  sectionFor,
  transitionSchema,
} from "./rules";

async function note(
  tx: DbClient,
  actor: ControlsActor,
  row: MoneyControlRecord,
  action: string,
  reference = "",
  notes = "",
) {
  await tx.moneyControlEvent.create({
    data: {
      workspaceId: actor.workspace.id,
      recordId: row.id,
      actorId: actor.user.id,
      action,
      reference,
      notes,
    },
  });
  await recordAuditEvent({
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    action: `moneycontrols.${action.toLowerCase()}`,
    targetType: "money_control",
    targetId: row.id,
    client: tx,
  });
  if (row.payroll) await removeSearchDocument("money_control", row.id, tx);
  if (!row.payroll) {
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: "money_control",
        entityId: row.id,
        title: row.title,
        url: `/w/${actor.workspace.slug}/money-controls/${sectionFor(row.kind)}?edit=${row.id}`,
        visibility: "PRIVATE",
        ownerId: row.ownerId ?? actor.user.id,
      },
      tx,
    );
    await recordActivity(
      {
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        entityType: "money_control",
        entityId: row.id,
        verb: action.toLowerCase(),
        summary: "An internal control record changed.",
        visibility: "PRIVATE",
      },
      tx,
    );
  }
}
function required(value: unknown, message: string): asserts value {
  if (!value) throw new FinanceError(message);
}
async function proof(tx: DbClient, row: MoneyControlRecord, pdf = false) {
  required(
    await tx.moneyControlAttachment.findFirst({
      where: {
        workspaceId: row.workspaceId,
        recordId: row.id,
        file: {
          deletedAt: null,
          ...(pdf ? { contentType: "application/pdf" } : {}),
        },
      },
    }),
    pdf
      ? "Upload the official certificate PDF first."
      : "Attach the receipt or supporting proof first.",
  );
}
async function cashFloat(
  tx: DbClient,
  row: { workspaceId: string; accountId: string | null },
) {
  const f = await tx.moneyControlRecord.findFirst({
    where: {
      workspaceId: row.workspaceId,
      kind: "FLOAT",
      accountId: row.accountId,
      status: "ACTIVE",
    },
  });
  required(f, "Set up this cash account's float and custodian first.");
  return f;
}
async function update(
  tx: DbClient,
  row: MoneyControlRecord,
  data: Prisma.MoneyControlRecordUpdateManyMutationInput,
) {
  await tx.moneyControlRecord.updateMany({
    where: { workspaceId: row.workspaceId, id: row.id },
    data,
  });
}
async function checkLinks(
  tx: DbClient,
  actor: ControlsActor,
  v: ReturnType<typeof recordSchema.parse>,
) {
  await validateMember(tx, actor.workspace.id, v.ownerId || null);
  if (v.ownerId)
    required(
      await tx.membership.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          userId: v.ownerId,
          status: "ACTIVE",
          role: { not: "GUEST" },
          user: { disabledAt: null },
        },
      }),
      "Choose an active team member as owner.",
    );
  await validateTags(
    tx,
    actor.workspace.id,
    {
      accountId: v.accountId || null,
      categoryId: v.categoryId || null,
      fundId: v.fundId || null,
    },
    v.currency,
    ["VOUCHER"].includes(v.kind) ? "EXPENSE" : undefined,
  );
  if (v.otherAccountId) {
    required(
      v.otherAccountId !== v.accountId,
      "Choose two different accounts.",
    );
    await validateTags(
      tx,
      actor.workspace.id,
      { accountId: v.otherAccountId },
      v.currency,
    );
  }
  if (v.assetId)
    required(
      await tx.asset.findFirst({
        where: { workspaceId: actor.workspace.id, id: v.assetId },
      }),
      "Choose equipment in this workspace.",
    );
  if (v.parentId) {
    const parent = await controlRecord(actor, v.parentId, false, tx);
    required(
      v.parentId !== v.id && parent.payroll === v.payroll,
      "Choose a matching parent record.",
    );
  }
  if (v.complianceId)
    required(
      await tx.governanceRecord.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: v.complianceId,
          kind: "OBLIGATION",
          archivedAt: null,
        },
      }),
      "Choose an active compliance-calendar obligation.",
    );
  if (v.checklistRunId)
    required(
      await tx.checklistRun.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: v.checklistRunId,
          subjectUserId: v.ownerId,
          kind: { in: ["ONBOARDING", "OFFBOARDING"] },
        },
      }),
      "Choose this person's onboarding or offboarding checklist.",
    );
}
export async function saveControl(actor: ControlsActor, input: unknown) {
  const a = await controlsAccess(actor);
  required(a.manage, "You don't have access to do that.");
  const v = recordSchema.parse(input),
    d = detailsSchemas[v.kind].parse(v.details) as Record<string, unknown>;
  if (
    ["TDS_DEDUCTION", "CERTIFICATE"].includes(v.kind) &&
    (/^192(?:\D|$)/.test(String(d.section ?? "")) ||
      /^(?:form\s*)?16$/i.test(String(d.form ?? "").trim()))
  )
    v.payroll = true;
  required(
    !v.payroll || ["TDS_DEDUCTION", "CERTIFICATE", "FILING"].includes(v.kind),
    "Use the private payroll register for salary payments.",
  );
  if (v.payroll)
    required(
      a.payrollManage,
      "Payroll records need an explicit Manage payroll grant.",
    );
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const current = await controlsAccess(actor, tx);
    required(
      current.manage && (!v.payroll || current.payrollManage),
      "You don't have access to do that.",
    );
    const prior = v.id ? await controlRecord(actor, v.id, true, tx) : null;
    if (prior?.payroll)
      required(
        v.payroll,
        "Payroll confidentiality cannot be removed from a record.",
      );
    if (prior)
      required(
        prior.kind === v.kind &&
          (prior.status === "DRAFT" ||
            ["ASSET_CATEGORY", "FUND_RULE", "FLOAT"].includes(prior.kind)),
        "This record is confirmed. Keep its saved facts and add a new record for a correction.",
      );
    await checkLinks(tx, actor, v);
    const accountKinds = [
      "FLOAT",
      "VOUCHER",
      "COUNT",
      "REPLENISHMENT",
      "HANDOVER",
      "DEPOSIT",
      "TRANSFER",
    ];
    if (accountKinds.includes(v.kind))
      required(v.accountId, "Choose a bank or cash account.");
    if (["TRANSFER", "REPLENISHMENT"].includes(v.kind))
      required(v.otherAccountId, "Choose the other account.");
    if (["FLOAT", "HANDOVER", "ASSIGNMENT"].includes(v.kind))
      required(v.ownerId, "Choose the person responsible.");
    if (["SCHEDULE", "VERIFICATION", "DISPOSAL", "ASSIGNMENT"].includes(v.kind))
      required(v.assetId, "Choose equipment from the existing asset register.");
    if (
      [
        "VOUCHER",
        "REPLENISHMENT",
        "DEPOSIT",
        "TRANSFER",
        "SCHEDULE",
        "TDS_DEDUCTION",
        "FUND_RULE",
        "FLOAT",
      ].includes(v.kind)
    )
      required(v.amountMinor > 0, "Enter a positive amount.");
    if (v.kind === "FUND_RULE") {
      required(
        v.fundId && v.endsOn,
        "Choose a fund and the eligible start and end dates.",
      );
      for (const cat of d.allowedCategoryIds as string[])
        await validateTags(
          tx,
          actor.workspace.id,
          { categoryId: cat },
          v.currency,
          "EXPENSE",
        );
    }
    if (v.kind === "FLOAT" && prior)
      required(
        prior.ownerId === v.ownerId &&
          prior.accountId === v.accountId &&
          prior.currency === v.currency,
        "Use a signed handover to change the custodian. Keep this account and currency.",
      );
    if (v.kind === "HANDOVER") {
      const f = await cashFloat(tx, {
        workspaceId: actor.workspace.id,
        accountId: v.accountId,
      });
      required(
        f.ownerId !== v.ownerId,
        "Choose a different incoming custodian.",
      );
      d.outgoingId = f.ownerId;
    }
    if (v.kind === "COUNT")
      countDenominations(String(d.denominations), v.currency);
    if (v.kind === "SCHEDULE") {
      const cat = await controlRecord(
        actor,
        String(d.categoryRecordId),
        false,
        tx,
      );
      required(
        cat.kind === "ASSET_CATEGORY" && cat.currency === v.currency,
        "Choose a depreciation category in the asset’s currency.",
      );
      const basis = detailsSchemas.ASSET_CATEGORY.parse(cat.details);
      required(
        basis.residualMinor <= v.amountMinor,
        "Residual value cannot exceed purchase cost.",
      );
      d.basis = basis;
    }
    if (["TDS_DEDUCTION", "CERTIFICATE", "FILING"].includes(v.kind)) {
      if (v.kind === "TDS_DEDUCTION")
        required(
          Number(d.fiscalYear) === fiscalYear(v.occurredOn) &&
            (d.quarter === fiscalQuarter(v.occurredOn) ||
              d.quarter === "ANNUAL"),
          "Match the deduction date to its financial year and quarter.",
        );
      if (d.contactId) {
        const contact = await tx.contact.findFirst({
          where: {
            workspaceId: actor.workspace.id,
            id: String(d.contactId),
            deletedAt: null,
            OR: [
              { visibility: "WORKSPACE" },
              { ownerId: actor.user.id },
              { visibility: "PRIVATE" },
            ],
          },
        });
        required(contact, "Choose an available CRM payee in this workspace.");
      }
      if (v.kind === "TDS_DEDUCTION")
        required(
          Number(d.grossMinor) >= v.amountMinor,
          "TDS cannot exceed the gross payment.",
        );
      if (v.kind === "CERTIFICATE" && v.parentId) {
        const deduction = await controlRecord(actor, v.parentId, false, tx),
          dd = details(deduction);
        required(
          deduction.kind === "TDS_DEDUCTION" &&
            deduction.currency === v.currency &&
            dd.payee === d.payee &&
            dd.fiscalYear === d.fiscalYear &&
            dd.quarter === d.quarter &&
            (!d.section || d.section === dd.section),
          "Match the certificate to the payee, section, currency and quarter of its deduction.",
        );
      }
    }
    if (v.kind === "ASSIGNMENT" && prior)
      required(
        prior.ownerId === v.ownerId && prior.assetId === v.assetId,
        "Keep the assigned person and asset, or create another assignment.",
      );
    const key =
      v.kind === "FLOAT"
        ? v.accountId
        : v.kind === "SCHEDULE"
          ? v.assetId
          : v.kind === "FUND_RULE"
            ? v.fundId
            : null;
    const {
      id,
      kind,
      title,
      ownerId,
      accountId,
      otherAccountId,
      assetId,
      fundId,
      categoryId,
      parentId,
      complianceId,
      checklistRunId,
      occurredOn,
      endsOn,
      dueOn,
      ...rest
    } = v;
    const data = {
      ...rest,
      title,
      ownerId: ownerId || null,
      accountId: accountId || null,
      otherAccountId: otherAccountId || null,
      assetId: assetId || null,
      fundId: fundId || null,
      categoryId: categoryId || null,
      parentId: parentId || null,
      complianceId: complianceId || null,
      checklistRunId: checklistRunId || null,
      occurredOn: new Date(occurredOn),
      endsOn: endsOn ? new Date(endsOn) : null,
      dueOn: dueOn ? new Date(dueOn) : null,
      details: d as Prisma.InputJsonValue,
      recordKey: key,
    };
    const row = prior
      ? await tx.moneyControlRecord.update({
          where: { workspaceId_id: { workspaceId: actor.workspace.id, id } },
          data,
        })
      : await tx.moneyControlRecord.create({
          data: {
            ...data,
            kind,
            workspaceId: actor.workspace.id,
            createdById: actor.user.id,
            status: ["ASSET_CATEGORY", "FUND_RULE", "FLOAT"].includes(kind)
              ? "ACTIVE"
              : "DRAFT",
            number:
              kind === "VOUCHER"
                ? await nextWorkspaceSequence(
                    tx,
                    actor.workspace.id,
                    "cash-voucher",
                  )
                : null,
          },
        });
    await note(tx, actor, row, "SAVED");
    return row.id;
  });
}

async function movement(
  tx: DbClient,
  row: MoneyControlRecord,
  accountId: string,
  amountMinor: number,
  date: Date,
  reference: string,
  key: string,
) {
  await assertOpen(tx, row.workspaceId, date, accountId);
  await tx.moneyControlMovement.create({
    data: {
      workspaceId: row.workspaceId,
      recordId: row.id,
      accountId,
      amountMinor,
      currency: row.currency,
      occurredOn: date,
      reference,
      operationKey: key,
    },
  });
}
export async function transitionControl(actor: ControlsActor, input: unknown) {
  const v = transitionSchema.parse(input);
  const result = await prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const a = await controlsAccess(actor, tx),
      row = await controlRecord(actor, v.id, false, tx),
      d = details(row),
      date = new Date(v.occurredOn);
    if (/^(staff-advance:|emi:)/.test(row.recordKey??"")) throw new FinanceError("Manage this movement from Staff advances or Upcoming dues.");
    if (row.payroll)
      required(
        a.payrollManage,
        "Payroll records need an explicit Manage payroll grant.",
      );
    const personal = ["SIGN_IN", "SIGN_OUT", "ACKNOWLEDGE"].includes(
      v.operation,
    );
    if (!personal) required(a.manage, "You don't have access to do that.");
    if (row.assetId) await lockAsset(tx, row.workspaceId, row.assetId);
    // Retrying a financial operation must never post twice or change its saved facts.
    const previous = await tx.moneyControlEvent.findFirst({
      where: {
        workspaceId: row.workspaceId,
        recordId: row.id,
        reference: `key:${v.operationKey}`,
      },
    });
    if (previous) {
      required(
        previous.notes === JSON.stringify(v),
        "That operation reference was used with different details. Refresh and try again.",
      );
      return { id: row.id };
    }
    if (v.operation === "CANCEL") {
      required(
        ["DRAFT", "PENDING"].includes(row.status),
        "Only an unconfirmed record can be cancelled.",
      );
      const approvalId = d.approvalId;
      if (approvalId) {
        await tx.approvalRequest.updateMany({
          where: {
            workspaceId: row.workspaceId,
            id: String(approvalId),
            status: { in: ["PENDING", "CHANGES_REQUESTED"] },
          },
          data: { status: "CANCELLED", decidedAt: new Date() },
        });
      }
      await update(tx, row, { status: "CANCELLED" });
    } else if (v.operation === "REQUEST") {
      required(
        row.kind === "REPLENISHMENT" &&
          ["DRAFT", "PENDING"].includes(row.status),
        "Choose an unpaid replenishment request.",
      );
      const approval = await requestApproval(tx, {
        workspace: actor.workspace,
        subjectType: "CUSTOM",
        subjectId: row.id,
        title: `Replenish cash voucher account`,
        requesterId: actor.user.id,
        requesterName: actor.user.name,
        amountMinor: row.amountMinor,
        currency: row.currency,
      });
      await update(tx, row, {
        status: "PENDING",
        details: {
          ...d,
          approvalId: approval.requestId,
        } as Prisma.InputJsonValue,
      });
      await note(tx, actor, row, "REQUESTED");
      return { id: row.id, after: approval.afterCommit };
    } else if (v.operation === "SIGN_OUT" || v.operation === "SIGN_IN") {
      required(
        row.kind === "HANDOVER" && ["DRAFT", "PENDING"].includes(row.status),
        "Choose an unsigned custodian handover.",
      );
      const f = await cashFloat(tx, row);
      required(
        f.ownerId === d.outgoingId,
        "The custodian changed. Create a new handover.",
      );
      if (v.operation === "SIGN_OUT") {
        required(
          d.outgoingId === actor.user.id && !d.signedOutAt,
          "Only the outgoing custodian can sign this handover.",
        );
        const balance = await accountBalance(
          tx,
          row.workspaceId,
          row.accountId!,
          date,
        );
        required(
          balance.balanceMinor === row.amountMinor || v.notes.trim(),
          "Explain the difference between the handed-over cash and account balance.",
        );
        await update(tx, row, {
          status: "PENDING",
          details: {
            ...d,
            signedOutAt: new Date().toISOString(),
            signedOutOn: v.occurredOn,
            expectedMinor: balance.balanceMinor,
            differenceMinor: row.amountMinor - balance.balanceMinor,
            handoverNotes: v.notes,
          } as Prisma.InputJsonValue,
        });
      } else {
        required(
          row.ownerId === actor.user.id && d.signedOutAt,
          "The incoming custodian signs after the outgoing custodian.",
        );
        required(
          v.occurredOn >= String(d.signedOutOn),
          "The incoming signature cannot predate the outgoing signature.",
        );
        const balance = await accountBalance(
          tx,
          row.workspaceId,
          row.accountId!,
          date,
        );
        required(
          balance.balanceMinor === d.expectedMinor,
          "The account changed after sign-out. Cancel this handover and record a fresh count.",
        );
        await update(tx, row, {
          status: "CONFIRMED",
          details: {
            ...d,
            signedInAt: new Date().toISOString(),
            signedInOn: v.occurredOn,
          } as Prisma.InputJsonValue,
        });
        await update(tx, f, { ownerId: row.ownerId });
      }
    } else if (v.operation === "ACKNOWLEDGE") {
      required(
        row.kind === "ASSIGNMENT" &&
          row.status === "ASSIGNED" &&
          row.ownerId === actor.user.id &&
          !d.acknowledgedAt,
        "Only the assigned person can acknowledge this equipment.",
      );
      await update(tx, row, {
        details: {
          ...d,
          acknowledgedAt: new Date().toISOString(),
        } as Prisma.InputJsonValue,
      });
    } else if (v.operation === "RETURN") {
      required(
        v.reference &&
          v.occurredOn >= row.occurredOn.toISOString().slice(0, 10),
        "Enter a return date and reference after the original record date.",
      );
      if (row.kind === "ASSIGNMENT") {
        required(
          row.status === "ASSIGNED" && v.notes,
          "Choose an assigned asset and describe its return condition.",
        );
        await tx.asset.updateMany({
          where: {
            workspaceId: row.workspaceId,
            id: row.assetId!,
            ownerUserId: row.ownerId,
          },
          data: { ownerUserId: null, condition: v.notes.slice(0, 200) },
        });
        await update(tx, row, {
          status: "RETURNED",
          details: {
            ...d,
            returnedOn: v.occurredOn,
            returnedById: actor.user.id,
            returnCondition: v.notes,
          } as Prisma.InputJsonValue,
        });
      } else {
        required(
          row.kind === "DEPOSIT" &&
            ["POSTED", "PARTLY_RETURNED"].includes(row.status) &&
            v.amountMinor > 0 &&
            row.settledMinor + v.amountMinor <= row.amountMinor,
          "Enter a return up to the deposit's outstanding amount.",
        );
        await proof(tx, row);
        await movement(
          tx,
          row,
          row.accountId!,
          d.direction === "GIVEN" ? v.amountMinor : -v.amountMinor,
          date,
          v.reference,
          v.operationKey,
        );
        await update(tx, row, {
          settledMinor: row.settledMinor + v.amountMinor,
          status:
            row.settledMinor + v.amountMinor === row.amountMinor
              ? "RETURNED"
              : "PARTLY_RETURNED",
        });
      }
    } else if (["SUBMITTED", "ACCEPTED", "PAID"].includes(v.operation)) {
      const order = ["PREPARED", "SUBMITTED", "ACCEPTED", "PAID"];
      required(
        row.kind === "FILING" &&
          order.indexOf(v.operation) === order.indexOf(row.status) + 1,
        "Record prepared, submitted, accepted and paid in order.",
      );
      required(v.reference, "Enter the acknowledgement or payment reference.");
      await proof(tx, row);
      await update(tx, row, { status: v.operation });
    } else {
      required(v.operation === "POST", "Choose an available action.");
      await validateMember(tx, row.workspaceId, row.ownerId);
      await validateTags(
        tx,
        row.workspaceId,
        {
          accountId: row.accountId,
          categoryId: row.categoryId,
          fundId: row.fundId,
        },
        row.currency,
        row.kind === "VOUCHER" ? "EXPENSE" : undefined,
      );
      if (row.kind === "REPLENISHMENT") {
        required(
          row.status === "PENDING" && d.approvalId,
          "Request approval before recording replenishment.",
        );
        required(
          await tx.approvalRequest.findFirst({
            where: {
              workspaceId: row.workspaceId,
              id: String(d.approvalId),
              subjectType: "CUSTOM",
              subjectId: row.id,
              status: "APPROVED",
            },
          }),
          "Approve this replenishment in Requests first.",
        );
      } else
        required(row.status === "DRAFT", "This record is already confirmed.");
      if (
        [
          "VOUCHER",
          "DEPOSIT",
          "TRANSFER",
          "REPLENISHMENT",
          "SCHEDULE",
          "DISPOSAL",
          "VERIFICATION",
        ].includes(row.kind)
      )
        await proof(tx, row);
      if (row.kind === "CERTIFICATE") await proof(tx, row, true);
      if (
        [
          "VOUCHER",
          "DEPOSIT",
          "TRANSFER",
          "REPLENISHMENT",
          "DISPOSAL",
        ].includes(row.kind)
      )
        required(v.reference, "Enter the payment or voucher reference.");
      if (["VOUCHER", "COUNT", "REPLENISHMENT"].includes(row.kind))
        await cashFloat(tx, row);
      if (row.kind === "VOUCHER") {
        await assertOpen(tx, row.workspaceId, row.occurredOn, row.accountId);
        const balance = await accountBalance(
          tx,
          row.workspaceId,
          row.accountId!,
          row.occurredOn,
        );
        required(
          balance.balanceMinor >= row.amountMinor,
          "This voucher exceeds the cash account balance. Record replenishment first.",
        );
        const ledger = await tx.ledgerEntry.create({
          data: {
            workspaceId: row.workspaceId,
            kind: "EXPENSE",
            amountMinor: row.amountMinor,
            currency: row.currency,
            categoryId: row.categoryId,
            fundId: row.fundId,
            accountId: row.accountId,
            description: `Cash voucher CV-${String(row.number).padStart(5, "0")}: ${row.title}`,
            counterparty: String(d.payee ?? ""),
            occurredOn: row.occurredOn,
            sourceType: "cash_voucher",
            sourceId: row.id,
            createdById: actor.user.id,
          },
        });
        await financeNote(tx, actor, "entry", ledger.id, "created");
        await update(tx, row, {
          details: { ...d, ledgerEntryId: ledger.id } as Prisma.InputJsonValue,
        });
      } else if (["TRANSFER", "REPLENISHMENT"].includes(row.kind)) {
        const from =
            row.kind === "TRANSFER" ? row.accountId! : row.otherAccountId!,
          to = row.kind === "TRANSFER" ? row.otherAccountId! : row.accountId!;
        await movement(
          tx,
          row,
          from,
          -row.amountMinor,
          row.occurredOn,
          v.reference,
          v.operationKey,
        );
        await movement(
          tx,
          row,
          to,
          row.amountMinor,
          row.occurredOn,
          v.reference,
          v.operationKey,
        );
      } else if (row.kind === "DEPOSIT")
        await movement(
          tx,
          row,
          row.accountId!,
          d.direction === "GIVEN" ? -row.amountMinor : row.amountMinor,
          row.occurredOn,
          v.reference,
          v.operationKey,
        );
      else if (row.kind === "COUNT") {
        const counted = countDenominations(
            String(d.denominations),
            row.currency,
          ),
          balance = await accountBalance(
            tx,
            row.workspaceId,
            row.accountId!,
            row.occurredOn,
          ),
          difference = counted - balance.balanceMinor;
        required(
          !difference || row.notes.trim(),
          "Explain the cash-count difference before confirming.",
        );
        await update(tx, row, {
          amountMinor: counted,
          details: {
            ...d,
            expectedMinor: balance.balanceMinor,
            differenceMinor: difference,
            countedById: actor.user.id,
          } as Prisma.InputJsonValue,
        });
      } else if (row.kind === "SCHEDULE") {
        await tx.asset.updateMany({
          where: { workspaceId: row.workspaceId, id: row.assetId! },
          data: {
            purchaseDate: row.occurredOn,
            purchasePriceMinor: row.amountMinor,
            currency: row.currency,
          },
        });
      } else if (row.kind === "VERIFICATION") {
        await tx.asset.updateMany({
          where: { workspaceId: row.workspaceId, id: row.assetId! },
          data: { condition: String(d.condition), updatedAt: new Date() },
        });
        await update(tx, row, {
          details: {
            ...d,
            verifiedById: actor.user.id,
          } as Prisma.InputJsonValue,
        });
      } else if (row.kind === "DISPOSAL") {
        const asset = await tx.asset.findFirst({
          where: { workspaceId: row.workspaceId, id: row.assetId! },
        });
        required(
          asset && asset.status !== "RETIRED" && !asset.ownerUserId,
          "Return assigned equipment before disposal.",
        );
        const schedule = await tx.moneyControlRecord.findFirst({
          where: {
            workspaceId: row.workspaceId,
            kind: "SCHEDULE",
            assetId: row.assetId,
          },
        });
        required(
          !schedule || row.occurredOn >= schedule.occurredOn,
          "Disposal cannot predate purchase.",
        );
        required(
          !(await tx.moneyControlRecord.findFirst({
            where: {
              workspaceId: row.workspaceId,
              kind: "VERIFICATION",
              assetId: row.assetId,
              occurredOn: { gt: row.occurredOn },
              status: "RECORDED",
            },
          })),
          "Use a disposal date after the last verification.",
        );
        if (row.amountMinor) {
          required(
            d.method === "SALE" && row.accountId,
            "Sale proceeds need an account. Use zero proceeds for scrap or donation.",
          );
          await assertOpen(tx, row.workspaceId, row.occurredOn, row.accountId);
          await tx.ledgerEntry.create({
            data: {
              workspaceId: row.workspaceId,
              kind: "INCOME",
              amountMinor: row.amountMinor,
              currency: row.currency,
              description: `Asset disposal: ${row.title}`,
              occurredOn: row.occurredOn,
              accountId: row.accountId,
              sourceType: "asset_disposal",
              sourceId: row.id,
              createdById: actor.user.id,
            },
          });
        }
        await tx.asset.updateMany({
          where: { workspaceId: row.workspaceId, id: row.assetId! },
          data: { status: "RETIRED" },
        });
      } else if (row.kind === "ASSIGNMENT") {
        required(
          !(await tx.moneyControlRecord.findFirst({
            where: {
              workspaceId: row.workspaceId,
              assetId: row.assetId,
              kind: "ASSIGNMENT",
              status: "ASSIGNED",
            },
          })),
          "Return the current assignment before issuing this asset again.",
        );
        const asset = await tx.asset.findFirst({
          where: { workspaceId: row.workspaceId, id: row.assetId! },
        });
        required(
          asset &&
            asset.status === "AVAILABLE" &&
            (!asset.ownerUserId || asset.ownerUserId === row.ownerId),
          "Choose available equipment. Return its current assignment before changing the person.",
        );
        await validateMember(tx, row.workspaceId, row.ownerId);
        await tx.asset.updateMany({
          where: { workspaceId: row.workspaceId, id: row.assetId! },
          data: { ownerUserId: row.ownerId },
        });
      }
      const status =
        row.kind === "ASSIGNMENT"
          ? "ASSIGNED"
          : row.kind === "FILING"
            ? "PREPARED"
            : row.kind === "SCHEDULE"
              ? "ACTIVE"
              : ["COUNT"].includes(row.kind)
                ? "CONFIRMED"
                : ["TDS_DEDUCTION", "CERTIFICATE", "VERIFICATION"].includes(
                      row.kind,
                    )
                  ? "RECORDED"
                  : "POSTED";
      required(
        !["FLOAT", "ASSET_CATEGORY", "FUND_RULE", "HANDOVER"].includes(
          row.kind,
        ),
        "Use the record's available action.",
      );
      await update(tx, row, { status });
    }
    await note(
      tx,
      actor,
      row,
      v.operation,
      v.reference,
      `${formatDate(v.occurredOn, "UTC")}${v.notes ? ": " + v.notes : ""}`,
    );
    await tx.moneyControlEvent.create({
      data: {
        workspaceId: row.workspaceId,
        recordId: row.id,
        actorId: actor.user.id,
        action: "OPERATION",
        reference: `key:${v.operationKey}`,
        notes: JSON.stringify(v),
      },
    });
    return { id: row.id };
  });
  await result.after?.();
  return result.id;
}
export async function markControlMovement(actor: ControlsActor, id: string) {
  const a = await controlsAccess(actor);
  required(a.manage, "You don't have access to do that.");
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    required(
      (await controlsAccess(actor, tx)).manage,
      "You don't have access to do that.",
    );
    const row = await tx.moneyControlMovement.findFirst({
      where: { workspaceId: actor.workspace.id, id },
    });
    required(row, "That movement is unavailable.");
    const record = await controlRecord(actor,row.recordId,false,tx);
    if(record.payroll) required((await controlsAccess(actor,tx)).payrollManage,"Payroll movements need a Manage payroll grant.");
    await assertOpen(tx, row.workspaceId, row.occurredOn, row.accountId);
    await tx.moneyControlMovement.updateMany({
      where: { workspaceId: row.workspaceId, id },
      data: { reconciledAt: new Date() },
    });
    await recordAuditEvent({
      workspaceId: row.workspaceId,
      actorId: actor.user.id,
      action: "moneycontrols.movement_reconciled",
      targetType: "money_control",
      targetId: row.recordId,
      client: tx,
    });
    return row.recordId;
  });
}
