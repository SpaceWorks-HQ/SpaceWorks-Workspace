import { createHash } from "node:crypto";
/** Invented internal office examples; no fabricated uploaded evidence. */
export default async function seedMoneyControls(
  prisma,
  { workspaceId, workspace, users, channels },
) {
  void channels;
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeds are for local development only.");
  const owner = users.owner ?? Object.values(users)[0],
    member = users.meera ?? owner;
  const id = (key) =>
    `mc_${createHash("sha256").update(`${workspaceId}:${key}`).digest("hex").slice(0, 24)}`;
  const currency = workspace.currency ?? "INR",
    now = new Date(),
    year = now.getUTCFullYear() - (now.getUTCMonth() < 3 ? 1 : 0),
    start = new Date(`${year}-04-01`),
    on = new Date(`${year}-06-10`),
    due = new Date(`${year}-10-30`);
  const put = (model, key, data) =>
    model.upsert({
      where: { id: id(key) },
      create: { id: id(key), ...data },
      update: {},
    });
  const account = await prisma.financeAccount.upsert({
    where: { workspaceId_name: { workspaceId, name: "Office petty cash" } },
    create: {
      workspaceId,
      name: "Office petty cash",
      currency,
      openingMinor: 500000,
      openingOn: start,
    },
    update: {},
  });
  const bank = await prisma.financeAccount.upsert({
    where: { workspaceId_name: { workspaceId, name: "Office operating bank" } },
    create: {
      workspaceId,
      name: "Office operating bank",
      currency,
      openingMinor: 15000000,
      openingOn: start,
    },
    update: {},
  });
  const fund = await prisma.financeFund.upsert({
    where: {
      workspaceId_name: { workspaceId, name: "Community repair grant" },
    },
    create: {
      workspaceId,
      name: "Community repair grant",
      currency,
      restricted: true,
      funder: "Kerala Community Foundation",
    },
    update: {},
  });
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
  const asset = await put(prisma.asset, "laptop", {
    workspaceId,
    name: "Office accounts laptop",
    category: "IT equipment",
    tag: `office-${id("tag")}`,
    condition: "Good",
    location: "Kochi office",
  });
  const record = (key, kind, title, amountMinor, details = {}, extra = {}) =>
    put(prisma.moneyControlRecord, key, {
      workspaceId,
      kind,
      title,
      amountMinor,
      currency,
      occurredOn: on,
      createdById: owner.id,
      ownerId: owner.id,
      details,
      ...extra,
    });
  await record(
    "float",
    "FLOAT",
    "Office petty-cash float",
    500000,
    {},
    { accountId: account.id, recordKey: account.id, status: "ACTIVE" },
  );
  const voucher = await record(
    "voucher",
    "VOUCHER",
    "Travel to the programme venue",
    45000,
    { payee: "Office volunteer", reference: "Travel note" },
    {
      accountId: account.id,
      categoryId: category.id,
      notes: "Draft: attach the actual receipt before confirming.",
    },
  );
  if (voucher.number === null)
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`finance-tools:${workspaceId}`}))`;
      const current = await tx.moneyControlRecord.findFirst({
        where: { workspaceId, id: voucher.id },
      });
      if (current?.number !== null) return;
      const counter = await tx.workspaceCounter.upsert({
        where: { workspaceId_name: { workspaceId, name: "cash-voucher" } },
        create: { workspaceId, name: "cash-voucher", value: 1 },
        update: { value: { increment: 1 } },
      });
      await tx.moneyControlRecord.updateMany({
        where: { workspaceId, id: voucher.id, number: null },
        data: { number: counter.value },
      });
    });
  await record(
    "count",
    "COUNT",
    "Monthly office cash count",
    0,
    { denominations: "500=8,100=10" },
    {
      accountId: account.id,
      notes: "Record the actual denomination count and explain any difference.",
    },
  );
  await record(
    "replenish",
    "REPLENISHMENT",
    "Top up the office cash tin",
    200000,
    { reference: "Office cash top-up" },
    { accountId: account.id, otherAccountId: bank.id, dueOn: due },
  );
  await record(
    "handover",
    "HANDOVER",
    "Cash custodian change",
    500000,
    { outgoingId: owner.id },
    { accountId: account.id, ownerId: member.id },
  );
  await record(
    "deposit",
    "DEPOSIT",
    "Office lease security deposit",
    2500000,
    {
      direction: "GIVEN",
      counterparty: "Kochi community office landlord",
      reference: "Lease deposit",
    },
    { accountId: bank.id, dueOn: new Date(`${year + 1}-03-31`) },
  );
  const basis = {
    method: "SLM",
    lifeYears: 5,
    rateBps: 2000,
    residualMinor: 0,
    taxBlockNote:
      "Illustrative book policy. Confirm the applicable Income-tax block and effective rate with the accountant.",
  };
  const assetCategory = await record(
    "asset-category",
    "ASSET_CATEGORY",
    "Office computers — book policy",
    0,
    basis,
    { status: "ACTIVE" },
  );
  await record(
    "schedule",
    "SCHEDULE",
    "Office accounts laptop",
    6500000,
    {
      categoryRecordId: assetCategory.id,
      fundingSource: "Community repair grant",
      basis,
    },
    {
      assetId: asset.id,
      fundId: fund.id,
      recordKey: asset.id,
      notes:
        "Draft: upload the purchase bill before adding to the fixed-asset schedule.",
    },
  );
  await record(
    "verification",
    "VERIFICATION",
    "Laptop physical verification",
    0,
    { condition: "Good; charger present" },
    { assetId: asset.id, dueOn: due },
  );
  await record(
    "assignment",
    "ASSIGNMENT",
    "Laptop issue to office coordinator",
    0,
    { condition: "Good; charger and sleeve", reference: "IT issue sheet" },
    { assetId: asset.id, ownerId: member.id, dueOn: due },
  );
  await record(
    "deduction",
    "TDS_DEDUCTION",
    "Office rent withholding",
    100000,
    {
      payee: "Office landlord",
      section: "194-I / accountant to confirm",
      fiscalYear: year,
      quarter: "Q1",
      grossMinor: 1000000,
      reference: "June rent",
    },
  );
  await record(
    "certificate",
    "CERTIFICATE",
    "Official certificate expected",
    100000,
    {
      payee: "Office landlord",
      section: "194-I / accountant to confirm",
      fiscalYear: year,
      quarter: "Q1",
      direction: "ISSUED",
      form: "Form 16A / current official equivalent",
      certificateNumber: "Demo draft",
      deliveredOn: "",
    },
    {
      parentId: id("deduction"),
      dueOn: due,
      notes:
        "Upload the official TRACES PDF; this draft is not an issued certificate.",
    },
  );
  await record(
    "filing",
    "FILING",
    "Quarterly TDS return preparation",
    100000,
    {
      fiscalYear: year,
      quarter: "Q1",
      form: "Quarterly withholding return",
      acknowledgement: "Accountant preparation pending",
    },
    { dueOn: due },
  );
  await record(
    "fund-rule",
    "FUND_RULE",
    "Community repair grant eligibility",
    10000000,
    {
      allowedCategoryIds: [category.id],
      eligibilityMode: "WARN",
      budgetMode: "BLOCK",
      duplicateMode: "BLOCK",
    },
    {
      fundId: fund.id,
      recordKey: fund.id,
      status: "ACTIVE",
      occurredOn: start,
      endsOn: new Date(`${year + 1}-03-31`),
      notes:
        "Only programme supplies. Review dates and the signed agreement with the funder.",
    },
  );
}
