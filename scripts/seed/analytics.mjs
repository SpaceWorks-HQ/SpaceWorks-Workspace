/** Read existing demo data; add only useful saved views and one labelled cash assumption. */
export default async function seedAnalytics(
  prisma,
  { workspaceId, workspace, users },
) {
  const owner = users.admin ?? Object.values(users)[0];
  for (const [name, section, period, commentary] of [
    [
      "Office management review",
      "home",
      "last-month",
      "Review the Kochi office spending, open actions and programme commitments before the committee meeting. Cash forecasts are assumptions until the source records are confirmed.",
    ],
    [
      "Programme funding and reporting",
      "funding",
      "fy",
      "Keep restricted funds separate. Compare the grants register with the finance ledger and attach the reviewed programme reports in Funding.",
    ],
    [
      "Team attendance and volunteering",
      "people",
      "month",
      "Check missing attendance and approved leave before interpreting changes. Hours are manually logged and approved.",
    ],
  ]) {
    const existing = await prisma.analyticsPreset.findFirst({
      where: { workspaceId, ownerId: owner.id, name },
    });
    if (!existing)
      await prisma.analyticsPreset.create({
        data: {
          workspaceId,
          ownerId: owner.id,
          name,
          section,
          query: { section, period, currency: workspace.currency ?? "INR" },
          shared: true,
          pinned: true,
          commentary,
        },
      });
  }
  const title = "Office printer service · forecast assumption";
  if (
    !(await prisma.analyticsAdjustment.count({ where: { workspaceId, title } }))
  ) {
    const due = new Date();
    due.setUTCDate(due.getUTCDate() + 21);
    due.setUTCHours(0, 0, 0, 0);
    await prisma.analyticsAdjustment.create({
      data: {
        workspaceId,
        title,
        dueOn: due,
        amountMinor: -350000,
        currency: "INR",
        notes:
          "A one-off planning estimate for the community office. No bill or ledger entry is created. Replace or remove it after a real bill is logged.",
        createdById: owner.id,
      },
    });
  }
}
