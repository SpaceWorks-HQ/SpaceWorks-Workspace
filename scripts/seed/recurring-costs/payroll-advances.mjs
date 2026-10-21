export async function seedPayrollAdvances(prisma, {
  workspaceId,
  owner,
  staff,
  id,
  put,
  start,
  year,
  month,
  currency,
  category,
  fund,
  centre,
  account,
}) {
  await prisma.financePayrollGrant.upsert({
    where: { workspaceId_userId: { workspaceId, userId: owner.id } },
    create: {
      workspaceId,
      userId: owner.id,
      manage: true,
      grantedById: owner.id,
    },
    update: {},
  });
  const profile = await put(prisma.financePayProfile, "staff-profile", {
    workspaceId,
    name: staff.name ?? "Office team member",
    userId: staff.id,
    kind: "STAFF",
    currency,
    rateMinor: 3000000,
    pfApplicable: true,
    esiApplicable: true,
    ptApplicable: true,
    tdsSection: "192",
    costCentreId: centre.id,
  });
  const pay = await put(prisma.financePayRun, "paid-run", {
    workspaceId,
    profileId: profile.id,
    month: start.toISOString().slice(0, 7),
    currency,
    grossMinor: 3000000,
    pfMinor: 180000,
    esiMinor: 22500,
    ptMinor: 20000,
    tdsMinor: 100000,
    advancesMinor: 500000,
    netMinor: 2177500,
    status: "PAID",
    paidOn: start,
    reference: "DEMO-SALARY",
    categoryId: category.id,
    fundId: fund.id,
    costCentreId: centre.id,
    accountId: account.id,
    createdById: owner.id,
  });
  for (const [kind, amount] of [
    ["PF", 180000],
    ["ESI", 22500],
    ["PT", 20000],
    ["SALARY_TDS", 100000],
  ]) {
    const dueOn = new Date(
      Date.UTC(year, month + 1, kind === "SALARY_TDS" ? 7 : 15),
    );
    const bill = await put(prisma.financeBill, `statutory-${kind}`, {
      workspaceId,
      vendor: `${kind} remittance`,
      number: `DEMO-${kind}-${pay.month}`,
      issuedOn: start,
      dueOn,
      amountMinor: amount,
      currency,
      privatePayroll: true,
      accountId: account.id,
      categoryId: category.id,
      fundId: fund.id,
      costCentreId: centre.id,
      createdById: owner.id,
    });
    await put(prisma.recurringCostDue, `statutory-due-${kind}`, {
      workspaceId,
      sourceKey: `pay:${pay.id}:${kind}`,
      kind,
      dueOn,
      billId: bill.id,
      payRunId: pay.id,
    });
  }
  const advance = await put(prisma.staffAdvance, "staff-advance", {
    workspaceId,
    requestKey: id("staff-advance"),
    userId: staff.id,
    profileId: profile.id,
    reason: "Demo salary advance for urgent family travel",
    amountMinor: 2000000,
    currency,
    instalments: 4,
    startsOn: start,
    accountId: account.id,
    costCentreId: centre.id,
    fundId: fund.id,
    status: "PAID",
    paidOn: start,
    createdById: owner.id,
  });
  const advanceCash = await put(prisma.moneyControlRecord, "advance-cash", {
    workspaceId,
    kind: "DEPOSIT",
    recordKey: `staff-advance:${advance.id}`,
    title: "Staff advance",
    status: "CONFIRMED",
    ownerId: staff.id,
    accountId: account.id,
    amountMinor: 2000000,
    settledMinor: 500000,
    currency,
    occurredOn: start,
    payroll: true,
    createdById: owner.id,
    details: {
      direction: "GIVEN",
      counterparty: "Staff advance",
      reference: "DEMO-ADVANCE",
    },
  });
  await prisma.staffAdvance.updateMany({
    where: { workspaceId, id: advance.id },
    data: { depositId: advanceCash.id },
  });
  await prisma.moneyControlMovement.upsert({
    where: {
      workspaceId_operationKey_accountId: {
        workspaceId,
        operationKey: `advance:${advance.id}`,
        accountId: account.id,
      },
    },
    create: {
      workspaceId,
      recordId: advanceCash.id,
      accountId: account.id,
      amountMinor: -2000000,
      currency,
      occurredOn: start,
      reference: "DEMO-ADVANCE",
      operationKey: `advance:${advance.id}`,
    },
    update: {},
  });
  for (let i = 0; i < 4; i++)
    await put(prisma.staffAdvanceRecovery, `recovery-${i}`, {
      workspaceId,
      advanceId: advance.id,
      instalment: i + 1,
      dueOn: new Date(Date.UTC(year, month + i, 1)),
      amountMinor: 500000,
      recoveredMinor: i === 0 ? 500000 : 0,
    });
  // Retain the demo pay-run allocation so it cannot be recovered a second time.
  await put(prisma.moneyControlEvent, "demo-recovery", {
    workspaceId,
    recordId: advanceCash.id,
    actorId: owner.id,
    action: "ADVANCE_RECOVERY",
    reference: id("demo-recovery"),
    notes: JSON.stringify({
      recoveryId: id("recovery-0"),
      amountMinor: 500000,
      paidOn: start.toISOString().slice(0, 10),
      reference: "DEMO-SALARY",
      payRunId: pay.id,
    }),
  });
}
