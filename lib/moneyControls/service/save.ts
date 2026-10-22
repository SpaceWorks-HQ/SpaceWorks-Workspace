import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { nextWorkspaceSequence } from "@/lib/counters";
import { lockFinance, validateTags } from "@/lib/finance/tools/access";
import { controlsAccess, controlRecord, details, type ControlsActor } from "../access";
import { countDenominations, detailsSchemas, fiscalQuarter, fiscalYear, recordSchema } from "../rules";
import { note } from "./events";
import { required, checkLinks } from "./validation";
import { cashFloat } from "./records";

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
