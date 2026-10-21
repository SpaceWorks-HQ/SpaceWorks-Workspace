import { createHash } from "node:crypto";
/** Invented internal office records; no fabricated uploaded proofs. */
export default async function seedRecurringCosts(
  prisma,
  { workspaceId, workspace, users, channels },
) {
  void channels;
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeds are for local development only.");
  const owner = users.owner ?? Object.values(users)[0],
    staff =
      users.meera ??
      Object.values(users).find((u) => u.id !== owner.id) ??
      owner;
  const id = (key) =>
    `rc_${createHash("sha256").update(`${workspaceId}:${key}`).digest("hex").slice(0, 24)}`;
  const put = (model, key, data) =>
    model.upsert({
      where: { id: id(key) },
      create: { id: id(key), ...data },
      update: {},
    });
  const now = new Date(),
    year = now.getUTCFullYear(),
    month = now.getUTCMonth(),
    start = new Date(Date.UTC(year, month, 1)),
    renewal = new Date(Date.UTC(year + 1, month, 1));
  const currency = "INR";
  const category = await prisma.financeCategory.upsert({
    where: {
      workspaceId_kind_name: {
        workspaceId,
        kind: "EXPENSE",
        name: "Office recurring costs",
      },
    },
    create: { workspaceId, kind: "EXPENSE", name: "Office recurring costs" },
    update: {},
  });
  const fund = await prisma.financeFund.upsert({
    where: { workspaceId_name: { workspaceId, name: "Office operating fund" } },
    create: { workspaceId, name: "Office operating fund", currency },
    update: {},
  });
  const centre = await prisma.financeCostCentre.upsert({
    where: { workspaceId_name: { workspaceId, name: "Community office" } },
    create: { workspaceId, name: "Community office", kind: "TEAM" },
    update: {},
  });
  const account = await prisma.financeAccount.upsert({
    where: { workspaceId_name: { workspaceId, name: "Office operating bank" } },
    create: {
      workspaceId,
      name: "Office operating bank",
      currency,
      openingMinor: 100000000,
      openingOn: new Date(Date.UTC(year, 0, 1)),
    },
    update: {},
  });
  const landlord = await put(prisma.contact, "landlord", {
    workspaceId,
    displayName: "Kochi Office Premises Trust",
    visibility: "PRIVATE",
    kinds: ["facilities"],
    ownerId: owner.id,
    createdById: owner.id,
  });
  const lease = await put(prisma.facilityLease, "lease", {
    workspaceId,
    title: "Community office lease",
    landlordContactId: landlord.id,
    ownerId: owner.id,
    rentMinor: 4500000,
    currency,
    startsOn: start,
    renewalOn: renewal,
    requestKey: id("lease-key"),
    notes: "Demo office: review rent and agree a 5% escalation before renewal.",
  });
  const deposit = await put(prisma.moneyControlRecord, "rent-deposit", {
    workspaceId,
    kind: "DEPOSIT",
    title: "Community office refundable security deposit",
    status: "POSTED",
    recordKey: id("rent-deposit"),
    ownerId: owner.id,
    accountId: account.id,
    amountMinor: 13500000,
    currency,
    occurredOn: start,
    endsOn: renewal,
    createdById: owner.id,
    details: {
      direction: "GIVEN",
      counterparty: landlord.displayName,
      reference: "DEMO-DEPOSIT",
      refundable: "YES",
    },
    notes: "₹1,35,000 refundable at exit. Proof intentionally missing in demo.",
  });
  await prisma.moneyControlMovement.upsert({
    where: {
      workspaceId_operationKey_accountId: {
        workspaceId,
        operationKey: id("rent-deposit"),
        accountId: account.id,
      },
    },
    create: {
      workspaceId,
      recordId: deposit.id,
      accountId: account.id,
      amountMinor: -13500000,
      currency,
      occurredOn: start,
      reference: "DEMO-DEPOSIT",
      operationKey: id("rent-deposit"),
    },
    update: {},
  });
  const insurance = await put(prisma.governanceRecord, "insurance", {
    workspaceId,
    kind: "INSURANCE",
    title: "Office fire insurance",
    status: "ACTIVE",
    ownerId: owner.id,
    startsOn: start,
    endsOn: renewal,
    dueOn: renewal,
    createdById: owner.id,
    details: {
      issuer: "Community Mutual (demo)",
      reference: "DEMO-FIRE-2026",
      scope: "Office and equipment",
      sumInsuredMinor: 500000000,
      premiumMinor: 1800000,
      premiumFrequency: "YEARLY",
      currency,
      obligationId: "",
    },
  });
  const definitions = [
    [
      "rent",
      "Office rent",
      "RENT",
      4500000,
      "MONTHLY",
      {
        contactId: landlord.id,
        payee: landlord.displayName,
        leaseId: lease.id,
        depositId: deposit.id,
        renewalOn: renewal,
        escalationPercent: 5,
        tdsSection: "194-I",
      },
    ],
    [
      "power",
      "Electricity estimate",
      "ELECTRICITY",
      650000,
      "MONTHLY",
      { estimated: true, payee: "Electricity utility" },
    ],
    [
      "broadband",
      "Broadband",
      "INTERNET",
      150000,
      "MONTHLY",
      { payee: "Office broadband supplier" },
    ],
    [
      "amc",
      "Fire-extinguisher AMC",
      "MAINTENANCE",
      450000,
      "QUARTERLY",
      { payee: "Local fire safety service" },
    ],
    [
      "equipment-loan",
      "Equipment loan EMI",
      "EMI",
      1000000,
      "MONTHLY",
      {
        payee: "Community equipment lender",
        principalMinor: 30000000,
        annualRatePercent: 9,
        tenure: 36,
      },
    ],
    [
      "fire-premium",
      "Fire insurance premium",
      "INSURANCE",
      1800000,
      "YEARLY",
      { payee: "Community Mutual (demo)", insuranceId: insurance.id },
    ],
  ];
  for (const [key, title, kind, amountMinor, frequency, extra] of definitions) {
    const s = await put(prisma.recurringCostSchedule, key, {
      workspaceId,
      requestKey: id(key),
      title,
      kind,
      payee: title,
      amountMinor,
      currency,
      frequency,
      dueDay: 1,
      startsOn: start,
      nextDueOn: new Date(
        Date.UTC(
          year,
          month +
            (frequency === "YEARLY" ? 12 : frequency === "QUARTERLY" ? 3 : 1),
          1,
        ),
      ),
      categoryId: category.id,
      fundId: fund.id,
      costCentreId: centre.id,
      accountId: account.id,
      ownerId: owner.id,
      createdById: owner.id,
      notes: "Manually reviewed demo. Tax rates are not statutory advice.",
      ...extra,
    });
    const bill = await put(prisma.financeBill, `${key}-bill`, {
      workspaceId,
      vendor: s.payee,
      number: `DEMO-${key}-${year}`,
      issuedOn: start,
      dueOn: start,
      amountMinor,
      currency,
      taxableMinor: amountMinor,
      needsActual: !!s.estimated,
      categoryId: category.id,
      fundId: fund.id,
      costCentreId: centre.id,
      accountId: account.id,
      createdById: owner.id,
    });
    await put(prisma.recurringCostDue, `${key}-due`, {
      workspaceId,
      scheduleId: s.id,
      sourceKey: `schedule:${s.id}:${start.toISOString().slice(0, 10)}`,
      kind,
      dueOn: start,
      billId: bill.id,
      ...(kind === "EMI"
        ? {
            principalMinor: 775000,
            interestMinor: 225000,
            splitConfirmed: true,
          }
        : {}),
    });
  }
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
  void workspace;
}
