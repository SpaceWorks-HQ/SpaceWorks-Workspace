import "server-only";
import { checkFundRecord } from "@/lib/moneyControls/funds";
import { prisma, type DbClient } from "@/lib/db";
import type { FinancePayRun, RecurringCostSchedule } from "@prisma/client";
import {
  financeAccess,
  FinanceError,
  lockFinance,
  validateTags,
  validateMember,
  auditPayView,
  type FinanceActor,
} from "@/lib/finance/tools/access";
import { indexSearchDocument } from "@/lib/search/documents";
import { recordActivity } from "@/lib/activity";
import { recordAuditEvent } from "@/lib/audit";
import { localDate } from "@/lib/finance/dates";
import {
  actualSchema,
  firstDue,
  nextDue,
  remittanceDate,
  scheduleSchema,
  taxAmounts,
} from "./rules";

export async function note(
  tx: DbClient,
  actor: FinanceActor,
  id: string,
  action: string,
) {
  await recordAuditEvent({
    client: tx,
    workspaceId: actor.workspace.id,
    actorId: actor.user.id,
    targetType: "recurring_cost",
    targetId: id,
    action: `finance.recurring_${action}`,
  });
}
async function references(
  tx: DbClient,
  actor: FinanceActor,
  v: ReturnType<typeof scheduleSchema.parse>,
) {
  const workspaceId = actor.workspace.id;
  if (
    v.kind === "EMI" &&
    (!v.accountId || v.estimated || v.gstPercent || v.tdsPercent)
  )
    throw new FinanceError(
      "EMIs need an account, a fixed cash amount and zero tax rates. Enter principal and interest on each bill.",
    );
  await validateTags(tx, workspaceId, v, v.currency, "EXPENSE");
  await validateMember(tx, workspaceId, v.ownerId);
  if (
    v.contactId &&
    !(await tx.contact.findFirst({
      where: { workspaceId, id: v.contactId, deletedAt: null },
    }))
  )
    throw new FinanceError("Choose a contact in this workspace.");
  if (
    v.organisationId &&
    !(await tx.organisation.findFirst({
      where: { workspaceId, id: v.organisationId, deletedAt: null },
    }))
  )
    throw new FinanceError("Choose an organisation in this workspace.");
  if (
    v.leaseId &&
    (v.kind !== "RENT" ||
      !(await tx.facilityLease.findFirst({
        where: {
          workspaceId,
          id: v.leaseId,
          status: "ACTIVE",
          currency: v.currency,
        },
      })))
  )
    throw new FinanceError("Choose an active lease in this currency.");
  if (
    v.subscriptionId &&
    !(await tx.subscription.findFirst({
      where: {
        workspaceId,
        id: v.subscriptionId,
        currency: v.currency,
        status: "ACTIVE",
      },
    }))
  )
    throw new FinanceError("Choose an active subscription in this currency.");
  if (
    v.insuranceId &&
    (v.kind !== "INSURANCE" ||
      !(await tx.governanceRecord.findFirst({
        where: {
          workspaceId,
          id: v.insuranceId,
          kind: "INSURANCE",
          archivedAt: null,
        },
      })))
  )
    throw new FinanceError("Choose an insurance register entry.");
  if (v.depositId) {
    const deposit = await tx.moneyControlRecord.findFirst({
      where: {
        workspaceId,
        id: v.depositId,
        kind: "DEPOSIT",
        payroll: false,
        currency: v.currency,
      },
    });
    if (
      !deposit ||
      (deposit.details as Record<string, unknown>).direction !== "GIVEN"
    )
      throw new FinanceError(
        "Choose a deposit given by this workspace in Money controls.",
      );
  }
}
export async function saveSchedule(actor: FinanceActor, input: unknown) {
  await financeAccess(actor, "MANAGE");
  const v = scheduleSchema.parse(input);
  taxAmounts(v.amountMinor, v.gstPercent, v.tdsPercent);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await financeAccess(actor, "MANAGE", tx);
    await references(tx, actor, v);
    const existing = await tx.recurringCostSchedule.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        ...(v.id ? { id: v.id } : { requestKey: v.requestKey }),
      },
    });
    if (v.id && !existing)
      throw new FinanceError("That schedule is unavailable.");
    if (existing && !v.id) return existing.id;
    const hasDues =
      existing &&
      (await tx.recurringCostDue.count({
        where: { workspaceId: actor.workspace.id, scheduleId: existing.id },
      }));
    if (
      hasDues &&
      (existing!.frequency !== v.frequency ||
        existing!.dueDay !== v.dueDay ||
        existing!.startsOn.toISOString().slice(0, 10) !== v.startsOn ||
        existing!.currency !== v.currency ||
        existing!.kind !== v.kind ||
        existing!.principalMinor !== v.principalMinor ||
        existing!.tenure !== v.tenure ||
        existing!.tdsSection !== v.tdsSection)
    )
      throw new FinanceError(
        "This schedule has bills. Pause it and add a new schedule to change its timing, kind, currency or loan principal.",
      );
    const { id, requestKey, startsOn, endsOn, renewalOn, ...rest } = v;
    void id;
    const data = {
      ...rest,
      startsOn: new Date(startsOn),
      endsOn: endsOn ? new Date(endsOn) : null,
      renewalOn: renewalOn ? new Date(renewalOn) : null,
      nextDueOn: hasDues
        ? existing!.nextDueOn
        : firstDue(new Date(startsOn), v.dueDay),
    };
    const row = existing
      ? await tx.recurringCostSchedule.update({
          where: {
            workspaceId_id: {
              workspaceId: actor.workspace.id,
              id: existing.id,
            },
          },
          data,
        })
      : await tx.recurringCostSchedule.create({
          data: {
            ...data,
            requestKey,
            workspaceId: actor.workspace.id,
            createdById: actor.user.id,
          },
        });
    await indexSearchDocument(
      {
        workspaceId: actor.workspace.id,
        entityType: "recurring_cost",
        entityId: row.id,
        title: row.title,
        visibility: "PRIVATE",
        ownerId: actor.user.id,
        url: `/w/${actor.workspace.slug}/finance/recurring?edit=${row.id}`,
      },
      tx,
    );
    await recordActivity(
      {
        workspaceId: actor.workspace.id,
        actorId: actor.user.id,
        entityType: "recurring_cost",
        entityId: row.id,
        verb: "saved",
        summary: "A recurring cost schedule changed.",
        visibility: "PRIVATE",
      },
      tx,
    );
    await note(tx, actor, row.id, "saved");
    return row.id;
  });
}
/** Source shortcuts copy editable facts once; later changes never rewrite already issued dues. */
export async function scheduleFromSource(
  actor: FinanceActor,
  source: "LEASE" | "INSURANCE" | "SUBSCRIPTION",
  sourceId: string,
) {
  await financeAccess(actor, "MANAGE");
  const workspaceId = actor.workspace.id;
  const base = {
    requestKey: `${source}:${sourceId}`,
    kind: "OTHER",
    frequency: "MONTHLY",
    dueDay: 1,
    startsOn: localDate(new Date(), actor.workspace.timezone),
    currency: actor.workspace.currency,
    title: "",
    payee: "",
    amountMinor: 0,
  };
  if (source === "LEASE") {
    const lease = await prisma.facilityLease.findFirst({
      where: { workspaceId, id: sourceId, status: "ACTIVE" },
    });
    if (!lease) throw new FinanceError("Choose an active lease.");
    const contact = await prisma.contact.findFirst({
      where: { workspaceId, id: lease.landlordContactId, deletedAt: null },
    });
    if (!contact) throw new FinanceError("Review the landlord contact first.");
    return saveSchedule(actor, {
      ...base,
      kind: "RENT",
      leaseId: lease.id,
      title: lease.title,
      payee: contact.displayName,
      contactId: contact.id,
      amountMinor: lease.rentMinor,
      currency: lease.currency,
      ownerId: lease.ownerId,
      renewalOn: lease.renewalOn.toISOString().slice(0, 10),
      tdsSection: "194-I",
      notes:
        "Review the due day, tax applicability and renewal escalation before the first bill.",
    });
  }
  if (source === "SUBSCRIPTION") {
    const s = await prisma.subscription.findFirst({
      where: { workspaceId, id: sourceId, status: "ACTIVE" },
    });
    if (
      !s?.amountMinor ||
      !["MONTHLY", "QUARTERLY", "YEARLY"].includes(s.period)
    )
      throw new FinanceError(
        "Set a fixed monthly, quarterly or yearly subscription amount first.",
      );
    const date = s.nextRenewalAt ?? new Date();
    return saveSchedule(actor, {
      ...base,
      kind: "SOFTWARE",
      subscriptionId: s.id,
      title: s.name,
      payee: s.name,
      organisationId: s.vendorOrgId,
      amountMinor: s.amountMinor,
      currency: s.currency,
      frequency: s.period,
      startsOn: date.toISOString().slice(0, 10),
      dueDay: date.getUTCDate(),
    });
  }
  const r = await prisma.governanceRecord.findFirst({
    where: { workspaceId, id: sourceId, kind: "INSURANCE", archivedAt: null },
  });
  if (!r) throw new FinanceError("Choose an insurance register entry.");
  const d = r.details as Record<string, unknown>;
  const date = r.dueOn ?? r.endsOn ?? new Date();
  return saveSchedule(actor, {
    ...base,
    kind: "INSURANCE",
    insuranceId: r.id,
    title: r.title,
    payee: String(d.issuer || r.title),
    amountMinor: Number(d.premiumMinor || 0),
    currency: String(d.currency || actor.workspace.currency),
    frequency: String(d.premiumFrequency || "YEARLY"),
    startsOn: date.toISOString().slice(0, 10),
    dueDay: date.getUTCDate(),
    ownerId: r.ownerId,
  });
}
export async function generateSchedule(
  tx: DbClient,
  s: RecurringCostSchedule,
  today: Date,
) {
  const workspaceId = s.workspaceId;
  if (
    (s.leaseId &&
      !(await tx.facilityLease.findFirst({
        where: { workspaceId, id: s.leaseId, status: "ACTIVE" },
      }))) ||
    (s.insuranceId &&
      !(await tx.governanceRecord.findFirst({
        where: {
          workspaceId,
          id: s.insuranceId,
          kind: "INSURANCE",
          archivedAt: null,
          status: { not: "CANCELLED" },
        },
      })))
  ) {
    await tx.recurringCostSchedule.updateMany({
      where: { workspaceId, id: s.id },
      data: { status: "PAUSED" },
    });
    return;
  }
  await validateTags(tx, workspaceId, s, s.currency, "EXPENSE");
  let due = s.nextDueOn;
  const horizon = new Date(+today + s.leadDays * 86400000);
  let count = await tx.recurringCostDue.count({
    where: { workspaceId, scheduleId: s.id },
  });
  // Bound each catch-up transaction; the persistent cursor resumes on the next beat.
  for (let i = 0; i < 120 && due <= horizon; i++) {
    if ((s.endsOn && due > s.endsOn) || (s.kind === "EMI" && count >= s.tenure))
      break;
    const sourceKey = `schedule:${s.id}:${due.toISOString().slice(0, 10)}`;
    if (
      !(await tx.recurringCostDue.findUnique({
        where: { workspaceId_sourceKey: { workspaceId, sourceKey } },
      }))
    ) {
      const tax = taxAmounts(s.amountMinor, s.gstPercent, s.tdsPercent);
      const bill = await tx.financeBill.create({
        data: {
          workspaceId,
          vendor: s.payee,
          number: `RC-${s.id.slice(-8)}-${due.toISOString().slice(0, 10)}`,
          issuedOn: today < due ? today : due,
          dueOn: due,
          amountMinor: tax.cashMinor,
          currency: s.currency,
          needsActual: s.estimated || s.gstPercent > 0,
          taxableMinor: s.amountMinor,
          igstMinor: 0,
          tdsMinor: tax.tdsMinor,
          categoryId: s.categoryId,
          fundId: s.fundId,
          costCentreId: s.costCentreId,
          accountId: s.accountId,
          ownerId: s.ownerId,
          notes: s.notes,
          purpose: s.title,
          createdById: s.createdById,
        },
      });
      await checkFundRecord(tx, workspaceId, s.createdById, "bill", bill.id);
      await tx.recurringCostDue.create({
        data: {
          workspaceId,
          sourceKey,
          scheduleId: s.id,
          kind: s.kind,
          dueOn: due,
          billId: bill.id,
        },
      });
      await recordAuditEvent({
        client: tx,
        workspaceId,
        action: "finance.recurring_bill_created",
        targetType: "bill",
        targetId: bill.id,
        metadata: { scheduleId: s.id },
      });
      count++;
    }
    due = nextDue(due, s.frequency, s.dueDay);
  }
  await tx.recurringCostSchedule.updateMany({
    where: { workspaceId, id: s.id },
    data: {
      nextDueOn: due,
      ...((s.endsOn && due > s.endsOn) ||
      (s.kind === "EMI" && count >= s.tenure)
        ? { status: "ENDED" }
        : {}),
    },
  });
}
/** Called in the PAY transaction and by beat for pre-existing paid runs. */
export async function createRemittances(tx: DbClient, run: FinancePayRun) {
  for (const [kind, amount] of [
    ["PF", run.pfMinor],
    ["ESI", run.esiMinor],
    ["PT", run.ptMinor],
    ["SALARY_TDS", run.tdsMinor],
  ] as const) {
    if (!amount) continue;
    const sourceKey = `pay:${run.id}:${kind}`,
      workspaceId = run.workspaceId;
    if (
      await tx.recurringCostDue.findUnique({
        where: { workspaceId_sourceKey: { workspaceId, sourceKey } },
      })
    )
      continue;
    const dueOn = remittanceDate(run.month, kind);
    const bill = await tx.financeBill.create({
      data: {
        workspaceId,
        vendor:
          kind === "SALARY_TDS"
            ? "Salary withholding · 192"
            : `${kind} remittance`,
        number: `${kind}-${run.month}-${run.id.slice(-8)}`,
        issuedOn: new Date(`${run.month}-01`),
        dueOn,
        amountMinor: amount,
        currency: run.currency,
        privatePayroll: true,
        categoryId: run.categoryId,
        fundId: run.fundId,
        costCentreId: run.costCentreId,
        accountId: run.accountId,
        createdById: run.createdById,
      },
    });
    await checkFundRecord(tx, workspaceId, run.createdById, "bill", bill.id);
    await tx.recurringCostDue.create({
      data: {
        workspaceId,
        sourceKey,
        kind,
        dueOn,
        billId: bill.id,
        payRunId: run.id,
      },
    });
  }
}
export async function confirmActual(actor: FinanceActor, input: unknown) {
  const v = actualSchema.parse(input);
  if (v.gstMinor || (v.igstMinor && (v.cgstMinor || v.sgstMinor)))
    throw new FinanceError(
      "Enter either CGST/SGST or IGST from the actual bill.",
    );
  v.gstMinor = v.cgstMinor + v.sgstMinor + v.igstMinor;
  if (
    v.gstMinor > 2147483647 ||
    v.amountMinor + v.tdsMinor - v.gstMinor > 2147483647
  )
    throw new FinanceError("Check the bill amount and tax components.");
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    const bill = await tx.financeBill.findFirst({
      where: { workspaceId: actor.workspace.id, id: v.billId },
      include: { recurringDue: true },
    });
    if (!bill) throw new FinanceError("That bill is unavailable.");
    await financeAccess(
      actor,
      bill.privatePayroll ? "PAY_MANAGE" : "MANAGE",
      tx,
    );
    if (bill.paidMinor)
      throw new FinanceError("Keep the details of a bill with payments.");
    if (!bill.recurringDue) throw new FinanceError("Choose a recurring bill.");
    if (v.tdsMinor > v.amountMinor)
      throw new FinanceError("TDS cannot exceed the bill amount.");
    if (
      bill.recurringDue.kind === "EMI" &&
      (v.principalMinor + v.interestMinor !== v.amountMinor ||
        v.gstMinor ||
        v.tdsMinor)
    )
      throw new FinanceError(
        "Principal plus interest must equal the EMI cash payment. Keep tax fields zero.",
      );
    if (bill.recurringDue.kind === "EMI" && bill.recurringDue.scheduleId) {
      const schedule = await tx.recurringCostSchedule.findFirst({
        where: {
          workspaceId: actor.workspace.id,
          id: bill.recurringDue.scheduleId,
        },
      });
      const other = await tx.recurringCostDue.aggregate({
        where: {
          workspaceId: actor.workspace.id,
          scheduleId: bill.recurringDue.scheduleId,
          id: { not: bill.recurringDue.id },
        },
        _sum: { principalMinor: true },
      });
      if (
        !schedule ||
        v.principalMinor + (other._sum.principalMinor ?? 0) >
          schedule.principalMinor
      )
        throw new FinanceError(
          "The principal allocation exceeds the original loan principal.",
        );
    }
    if (v.amountMinor + v.tdsMinor - v.gstMinor < 0)
      throw new FinanceError("Check the taxable value and taxes.");
    await tx.financeBill.updateMany({
      where: { workspaceId: actor.workspace.id, id: bill.id },
      data: {
        amountMinor: v.amountMinor,
        taxableMinor: v.amountMinor + v.tdsMinor - v.gstMinor,
        cgstMinor: v.cgstMinor,
        sgstMinor: v.sgstMinor,
        igstMinor: v.igstMinor,
        tdsMinor: v.tdsMinor,
        needsActual: false,
      },
    });
    await tx.recurringCostDue.updateMany({
      where: { workspaceId: actor.workspace.id, billId: bill.id },
      data: {
        principalMinor: v.principalMinor,
        interestMinor: v.interestMinor,
        splitConfirmed: true,
      },
    });
    await checkFundRecord(
      tx,
      actor.workspace.id,
      actor.user.id,
      "bill",
      bill.id,
    );
    await note(tx, actor, bill.id, "actual_confirmed");
    return bill.id;
  });
}
export async function changeRemittanceDue(
  actor: FinanceActor,
  billId: string,
  date: string,
) {
  const { isoDateSchema } = await import("@/lib/finance/schemas");
  isoDateSchema.parse(date);
  return prisma.$transaction(async (tx) => {
    await lockFinance(tx, actor.workspace.id);
    await financeAccess(actor, "PAY_MANAGE", tx);
    const row = await tx.recurringCostDue.findFirst({
      where: {
        workspaceId: actor.workspace.id,
        billId,
        payRunId: { not: null },
      },
      include: { bill: true },
    });
    if (!row || row.bill.paidMinor || new Date(date) < row.bill.issuedOn)
      throw new FinanceError(
        "Choose an unpaid remittance and a date after its bill date.",
      );
    await tx.financeBill.updateMany({
      where: { workspaceId: actor.workspace.id, id: billId },
      data: { dueOn: new Date(date) },
    });
    await tx.recurringCostDue.updateMany({
      where: { workspaceId: actor.workspace.id, id: row.id },
      data: { dueOn: new Date(date) },
    });
    await auditPayView(actor, "remittance", billId, tx);
    await note(tx, actor, billId, "due_changed");
    return billId;
  });
}
