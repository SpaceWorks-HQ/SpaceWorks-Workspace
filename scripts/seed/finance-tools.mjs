import { seedLedgerEntries } from "./finance-tools/ledger-entries.mjs";
import { createHash } from "node:crypto";

/** Manual office finance examples for an Indian community organisation. */
export default async function seedFinanceTools(
  prisma,
  { workspaceId, workspace, users, channels },
) {
  void channels;
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeds are for local development only.");
  const owner = users.owner ?? Object.values(users)[0];
  const member = users.meera ?? owner;
  const admin = Object.values(users).find((u) => u.id !== owner.id);
  const id = (key) =>
    `fin_${createHash("sha256").update(`${workspaceId}:${key}`).digest("hex").slice(0, 24)}`;
  const put = (model, key, data) =>
    model.upsert({
      where: { id: id(key) },
      create: { id: id(key), ...data },
      update: {},
    });
  const current = new Date(),
    month = current.toISOString().slice(0, 7),
    year = current.getUTCFullYear();
  const on = (day) =>
      new Date(`${month}-${String(day).padStart(2, "0")}T00:00:00Z`),
    last = new Date(Date.UTC(year, current.getUTCMonth() + 1, 0));
  const currency = workspace.currency ?? "INR";
  const category = await prisma.financeCategory.upsert({
    where: {
      workspaceId_kind_name: {
        workspaceId,
        kind: "EXPENSE",
        name: "Programme supplies",
      },
    },
    create: { workspaceId, kind: "EXPENSE", name: "Programme supplies" },
    update: {},
  });
  const income = await prisma.financeCategory.upsert({
    where: {
      workspaceId_kind_name: {
        workspaceId,
        kind: "INCOME",
        name: "Grants and donations",
      },
    },
    create: { workspaceId, kind: "INCOME", name: "Grants and donations" },
    update: {},
  });
  const restricted = await put(prisma.financeFund, "restricted", {
    workspaceId,
    name: "Community repair grant",
    currency,
    restricted: true,
    funder: "Kerala Community Foundation",
    notes:
      "Use only for repair training and programme materials. Retain agreement and reports here.",
  });
  const unrestricted = await put(prisma.financeFund, "unrestricted", {
    workspaceId,
    name: "Office kitty",
    currency,
    restricted: false,
    funder: "Local supporters",
  });
  const centre = await put(prisma.financeCostCentre, "centre", {
    workspaceId,
    name: "Repair skills programme",
    kind: "PROGRAMME",
    notes: "Internal programme cost tracking.",
  });
  await put(prisma.financeCostCentre, "event", {
    workspaceId,
    name: "October repair day",
    kind: "EVENT",
    externalReference: "community-repair-october",
    notes:
      "External event reference recorded manually; no event bookings are managed here.",
  });
  const account = await put(prisma.financeAccount, "bank", {
    workspaceId,
    name: "Office bank ending 4821",
    currency,
    openingMinor: 500000,
    openingOn: new Date(`${year}-01-01T00:00:00Z`),
  });
  const budget = await put(prisma.budget, "budget", {
    workspaceId,
    name: "Repair supplies this month",
    currency,
    amountMinor: 2500000,
    periodStart: on(1),
    periodEnd: last,
    categories: [category.id],
    costCentreId: centre.id,
    thresholdsPct: [80, 100],
    varianceNote:
      "Additional tools may be needed for the second training group.",
    createdById: owner.id,
  });
  await seedLedgerEntries(prisma, {
    workspaceId,
    owner,
    put,
    on,
    currency,
    restricted,
    unrestricted,
    centre,
    account,
    category,
    income,
    budget,
  });
  await put(prisma.financeBill, "bill-unpaid", {
    workspaceId,
    vendor: "Kochi Stationery Cooperative",
    number: "KSC-2026-104",
    issuedOn: on(2),
    dueOn: on(7),
    amountMinor: 590000,
    currency,
    taxableMinor: 500000,
    cgstMinor: 45000,
    sgstMinor: 45000,
    fundId: restricted.id,
    costCentreId: centre.id,
    accountId: account.id,
    categoryId: category.id,
    ownerId: owner.id,
    purpose: "Repair workshop stationery",
    createdById: owner.id,
  });
  const partial = await put(prisma.financeBill, "bill-partial", {
    workspaceId,
    vendor: "Neighbourhood Print Studio",
    number: "NPS-102",
    issuedOn: on(5),
    dueOn: on(25),
    amountMinor: 200000,
    paidMinor: 100000,
    currency,
    categoryId: category.id,
    costCentreId: centre.id,
    fundId: restricted.id,
    accountId: account.id,
    ownerId: owner.id,
    createdById: owner.id,
  });
  const payment = await put(prisma.financeBillPayment, "bill-part-payment", {
    workspaceId,
    billId: partial.id,
    paymentKey: id("bill-key"),
    amountMinor: 100000,
    paidOn: on(10),
    reference: "DEMO-UTR-PRINT-01",
    createdById: owner.id,
  });
  await put(prisma.ledgerEntry, "bill-ledger", {
    workspaceId,
    kind: "EXPENSE",
    amountMinor: payment.amountMinor,
    currency,
    description: "Bill NPS-102",
    counterparty: partial.vendor,
    occurredOn: on(10),
    fundId: restricted.id,
    costCentreId: centre.id,
    accountId: account.id,
    categoryId: category.id,
    sourceType: "finance_bill_payment",
    sourceId: payment.id,
    createdById: owner.id,
  });
  const close = await put(prisma.financeMonth, "month", { workspaceId, month });
  for (const [n, title] of [
    "Collect receipts and unpaid bills",
    "Reconcile bank and cash accounts",
    "Check payroll and statutory deposits",
    "Review spending and variances",
  ].entries())
    await put(prisma.financeMonthStep, `step-${n}`, {
      workspaceId,
      monthId: close.id,
      title,
      ownerId: owner.id,
      done: n === 0,
      notes: n === 0 ? "Waiting for the transport receipt." : null,
    });
  await put(prisma.financeReviewRule, "threshold", {
    workspaceId,
    categoryId: category.id,
    currency,
    thresholdMinor: 1000000,
  });
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
  if (admin)
    await prisma.financePayrollGrant.upsert({
      where: { workspaceId_userId: { workspaceId, userId: admin.id } },
      create: {
        workspaceId,
        userId: admin.id,
        manage: true,
        grantedById: owner.id,
      },
      update: {},
    });
  const profile = await put(prisma.financePayProfile, "pay-profile", {
    workspaceId,
    name: "Asha Menon (demo)",
    kind: "STAFF",
    currency,
    rateMinor: 3000000,
    rateBasis: "MONTH",
    pfApplicable: true,
    ptApplicable: true,
    tdsSection: "192",
    costCentreId: centre.id,
  });
  await put(prisma.financePayRun, "pay-run", {
    workspaceId,
    profileId: profile.id,
    month,
    currency,
    grossMinor: 3000000,
    allowancesMinor: 100000,
    pfMinor: 180000,
    esiMinor: 0,
    ptMinor: 20000,
    tdsMinor: 100000,
    advancesMinor: 0,
    otherMinor: 0,
    netMinor: 2800000,
    costCentreId: centre.id,
    accountId: account.id,
    categoryId: category.id,
    status: "DRAFT",
    createdById: owner.id,
  });
  await put(prisma.financeDisbursement, "advance", {
    workspaceId,
    payee: member.name ?? "Programme volunteer",
    purpose: "Repair programme travel advance",
    kind: "ADVANCE",
    amountMinor: 250000,
    currency,
    costCentreId: centre.id,
    fundId: restricted.id,
    accountId: account.id,
    categoryId: category.id,
    ownerId: owner.id,
    dueOn: on(25),
    createdById: owner.id,
  });
}
