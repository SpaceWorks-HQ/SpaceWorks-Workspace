// Loaded by the demo seed registry after its base ledger entries and categories.
export async function seedFinance(prisma, { workspaceId, workspace, users }) {
  const today = new Date();
  const day = (offset) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + offset));
  const categories = await prisma.financeCategory.findMany({ where: { workspaceId } });
  const income = categories.find((c) => c.kind === "INCOME");
  const expense = categories.find((c) => c.kind === "EXPENSE");
  for (let monthsAgo = 5; monthsAgo >= 1; monthsAgo -= 1) {
    const occurredOn = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - monthsAgo, 12));
    await prisma.ledgerEntry.createMany({ data: [
      { workspaceId, kind: "INCOME", amountMinor: 700000 + monthsAgo * 60000, currency: workspace.currency, categoryId: income?.id, description: "Member contributions", occurredOn, createdById: users.admin.id },
      { workspaceId, kind: "EXPENSE", amountMinor: 350000 + monthsAgo * 40000, currency: workspace.currency, categoryId: expense?.id, description: "Build night supplies", occurredOn, createdById: users.admin.id },
    ] });
  }
  const states = ["DRAFT", "SENT", "PAID", "VOID"];
  for (const [index, status] of states.entries()) {
    const number = `INV-${String(index + 1).padStart(4, "0")}`;
    const invoice = await prisma.invoice.create({ data: {
      workspaceId, number, clientName: ["Workshop partner", "Maker fair sponsor", "Community workshop", "Cancelled order"][index], status,
      issuedOn: day(-10), dueOn: day(index === 1 ? -2 : 7), currency: workspace.currency,
      items: [{ description: "Workbench session", quantity: 2, unitMinor: 150000 }], totalMinor: 300000,
      notes: "Thank you for supporting the next build night.", createdById: users.admin.id, ...(status === "PAID" ? { paidAt: day(-3) } : {}),
    } });
    if (status === "PAID") await prisma.ledgerEntry.create({ data: { workspaceId, kind: "INCOME", amountMinor: invoice.totalMinor, currency: invoice.currency, occurredOn: day(-3), description: `Invoice ${number}`, counterparty: invoice.clientName, categoryId: income?.id, sourceType: "invoice", sourceId: invoice.id, createdById: users.admin.id } });
  }
  await prisma.workspaceCounter.upsert({ where: { workspaceId_name: { workspaceId, name: "invoice" } }, create: { workspaceId, name: "invoice", value: states.length }, update: { value: states.length } });

}
