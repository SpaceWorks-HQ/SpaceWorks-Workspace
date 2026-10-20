/** Manual examples for an Indian NGO office; idempotent within a demo workspace. */
export default async function seedGovernance(
  prisma,
  { workspaceId, workspace, users, channels },
) {
  void workspace;
  void channels;
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeds are for local development only.");
  const ownerId = users.owner.id;
  const key = (name) => `${workspaceId}-governance-${name}`;
  const date = (days) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return new Date(d.toISOString().slice(0, 10));
  };
  async function record(name, data) {
    return prisma.governanceRecord.upsert({
      where: { id: key(name) },
      create: {
        id: key(name),
        workspaceId,
        ownerId,
        createdById: ownerId,
        ...data,
      },
      update: {},
    });
  }
  await record("entity", {
    kind: "LEGAL_ENTITY",
    key: "entity",
    title: "Kochi Community Learning Society",
    status: "ACTIVE",
    details: {
      entityType: "SOCIETY",
      registration: "DEMO-KL-2026-001",
      pan: "",
      tan: "",
      gstin: "",
      address: "Kochi, Kerala, India",
      otherIds: "Illustrative details only",
      fcra: "Not applicable",
      charity12a: "Review approval order with CA",
      charity80g: "Review approval order with CA",
      csr1: "",
    },
  });
  await record("filing", {
    kind: "OBLIGATION",
    title: "Review annual audit report with CA",
    status: "TODO",
    dueOn: date(7),
    reminderDays: 7,
    details: {
      recurrence: "ANNUALLY",
      acknowledgement: "",
      applicability:
        "Illustrative planning date; verify actual due date with CA.",
    },
  });
  await record("overdue", {
    kind: "OBLIGATION",
    title: "Confirm 80G approval validity",
    status: "TODO",
    dueOn: date(-3),
    details: {
      recurrence: "NONE",
      acknowledgement: "",
      applicability: "Check the approval order with CA.",
    },
  });
  const board = await record("board", {
    kind: "COMMITTEE",
    title: "Governing committee",
    status: "ACTIVE",
    details: {
      committeeType: "BOARD",
      mandate:
        "Review programmes, finances and compliance for the community office.",
    },
  });
  await record("term", {
    kind: "TERM",
    title: "Anjali Nair — secretary term",
    status: "ACTIVE",
    parentId: board.id,
    startsOn: date(-60),
    endsOn: date(670),
    details: { person: "Anjali Nair", position: "Secretary", contactId: "" },
  });
  await record("conflict", {
    kind: "CONFLICT",
    title: "Secretary annual conflict declaration",
    status: "DECLARED",
    parentId: board.id,
    dueOn: date(-1),
    details: {
      person: "Anjali Nair",
      declaration:
        "A relative operates a printing business. Recuse from related procurement decisions.",
      management: "Another committee member reviews printing quotations.",
    },
  });
  const meeting = await prisma.meeting.upsert({
    where: { id: key("meeting") },
    create: {
      id: key("meeting"),
      workspaceId,
      title: "Governing committee review",
      startsAt: date(14),
      visibility: "PRIVATE",
      facilitatorId: ownerId,
      createdById: ownerId,
    },
    update: {},
  });
  await record("minutes", {
    kind: "MINUTES",
    title: "Committee review — draft minutes",
    status: "DRAFT",
    parentId: board.id,
    meetingId: meeting.id,
    details: {
      content:
        "Review programme spending and confirm the annual audit handover. Circulate the final draft before approving.",
    },
  });
  const resolution = await prisma.governanceRecord.findUnique({
    where: { id: key("resolution") },
  });
  if (!resolution)
    await prisma.$transaction(async (tx) => {
      const counter = await tx.workspaceCounter.upsert({
        where: {
          workspaceId_name: { workspaceId, name: "governance_resolution" },
        },
        create: { workspaceId, name: "governance_resolution", value: 1 },
        update: { value: { increment: 1 } },
      });
      await tx.governanceRecord.create({
        data: {
          id: key("resolution"),
          workspaceId,
          kind: "RESOLUTION",
          title: "Approve annual audit engagement",
          status: "PASSED",
          parentId: board.id,
          meetingId: meeting.id,
          number: counter.value,
          ownerId,
          createdById: ownerId,
          details: {
            content:
              "Engage a CA for the annual audit following quotation review.",
            outcome: "Passed unanimously; secretary to collect quotations.",
          },
        },
      });
    });
  const year = new Date().getFullYear().toString();
  await record("agm", {
    kind: "AGM_ITEM",
    key: `agm:${board.id}:${year}:demo`,
    title: "Prepare annual report and audited accounts",
    status: "TODO",
    parentId: board.id,
    dueOn: date(30),
    details: { year },
  });
  const org = await prisma.organisation.upsert({
    where: { id: key("vendor-org") },
    create: {
      id: key("vendor-org"),
      workspaceId,
      name: "Ernakulam Print Cooperative",
      kinds: ["VENDOR"],
      visibility: "PRIVATE",
      ownerId,
      createdById: ownerId,
    },
    update: {},
  });
  const vendor = await record("vendor", {
    kind: "VENDOR",
    title: "Ernakulam Print Cooperative",
    status: "ACTIVE",
    organisationId: org.id,
    details: {
      pan: "",
      gstin: "",
      overseasTaxId: "",
      email: "printing@example.org",
      phone: "",
    },
    notes: "Request and verify bank instructions before the first payment.",
  });
  await record("contract", {
    kind: "CONTRACT",
    title: "Annual programme printing agreement",
    status: "ACTIVE",
    startsOn: date(-100),
    endsOn: date(35),
    reminderDays: 7,
    details: {
      vendorId: vendor.id,
      amountMinor: 6000000,
      currency: "INR",
      noticeDays: 30,
      reference: "DEMO-PRINT-2026",
    },
    notes: "Manual notice review; attach the signed agreement when available.",
  });
  for (const row of await prisma.governanceRecord.findMany({
    where: { workspaceId, archivedAt: null },
  })) {
    const section = ["LEGAL_ENTITY", "OBLIGATION"].includes(row.kind)
      ? ""
      : ["VENDOR", "CONTRACT"].includes(row.kind)
        ? "/vendors"
        : "/board";
    const data = {
      workspaceId,
      title: row.title,
      body: "",
      visibility: "PRIVATE",
      ownerId,
      url: `/w/${workspace.slug}/governance${section}?edit=${row.id}`,
    };
    await prisma.searchDocument.upsert({
      where: {
        entityType_entityId: { entityType: "governance", entityId: row.id },
      },
      create: { entityType: "governance", entityId: row.id, ...data },
      update: data,
    });
  }
}
