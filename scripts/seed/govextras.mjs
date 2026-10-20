/** Manual governance and safety examples for a Kochi community office. */
export default async function seedGovextras(
  prisma,
  { workspaceId, workspace, users, channels },
) {
  void workspace;
  void channels;
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeds are for local development only.");
  const ownerId = users.owner.id,
    key = (name) => `${workspaceId}-govextras-${name}`;
  const date = (n) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + n);
    return new Date(d.toISOString().slice(0, 10));
  };
  const record = (name, data) =>
    prisma.governanceRecord.upsert({
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
  let entity = await prisma.governanceRecord.findFirst({
    where: { workspaceId, kind: "LEGAL_ENTITY", archivedAt: null },
  });
  if (!entity)
    entity = await prisma.governanceRecord.create({
      data: {
        id: `${workspaceId}-governance-entity`,
        workspaceId,
        kind: "LEGAL_ENTITY",
        key: "entity",
        title: "Kochi Community Learning Society",
        status: "ACTIVE",
        ownerId,
        createdById: ownerId,
        details: { entityType: "SOCIETY" },
      },
    });
  const committee = await record("committee", {
    kind: "COMMITTEE",
    title: "Internal safeguarding committee",
    status: "ACTIVE",
    details: {
      committeeType: "COMMITTEE",
      mandate: "Designated confidential handling for the office team.",
    },
  });
  await prisma.safeguardingHandler.upsert({
    where: { workspaceId_userId: { workspaceId, userId: ownerId } },
    create: {
      workspaceId,
      userId: ownerId,
      committeeId: committee.id,
      appointedById: ownerId,
      endsOn: date(365),
    },
    update: {},
  });
  const doc = await prisma.doc.upsert({
    where: { id: key("emergency-doc") },
    create: {
      id: key("emergency-doc"),
      workspaceId,
      title: "Office evacuation and emergency contacts",
      contentText:
        "Keep exits clear. Gather at the marked assembly point. The shift lead checks attendance and contacts emergency services when needed.",
      contentHtml:
        "<p>Keep exits clear. Gather at the marked assembly point. The shift lead checks attendance and contacts emergency services when needed.</p>",
      createdById: ownerId,
      visibility: "ADMINS",
      verifiedById: ownerId,
      verifiedUntil: date(-2),
    },
    update: {},
  });
  const obligation = await record("renewal", {
    kind: "OBLIGATION",
    title: "Review office insurance renewal",
    status: "TODO",
    dueOn: date(20),
    details: {
      recurrence: "ANNUALLY",
      acknowledgement: "",
      applicability: "Illustrative planning date; check the policy documents.",
    },
  });
  await record("insurance", {
    kind: "INSURANCE",
    title: "Office contents and public liability cover",
    status: "ACTIVE",
    startsOn: date(-345),
    endsOn: date(20),
    reminderDays: 30,
    details: {
      issuer: "Demonstration insurer",
      reference: "DEMO-OFFICE-2026",
      scope: "Kochi community office contents and visitor liability",
      sumInsuredMinor: 250000000,
      premiumMinor: 1800000,
      currency: "INR",
      obligationId: obligation.id,
    },
  });
  for (const [name, kind, title] of [
    ["licence", "LICENCE", "Office trade licence"],
    ["registration", "REGISTRATION", "Society registration review"],
  ])
    await record(name, {
      kind,
      title,
      status: "ACTIVE",
      startsOn: date(-300),
      endsOn: date(65),
      details: {
        issuer: "Illustrative local authority",
        reference: `DEMO-${kind}-001`,
        scope: "Verify the applicable authority and renewal date manually.",
        currency: "INR",
        premiumMinor: 0,
        sumInsuredMinor: 0,
        obligationId: "",
      },
    });
  if (entity)
    await record("register", {
      kind: "STATUTORY_REGISTER",
      title: "Governing committee and members register",
      status: "NEEDS_REVIEW",
      dueOn: date(-3),
      details: {
        entityId: entity.id,
        registerType: "MEMBERS",
        scope: "Upload the reviewed snapshot from the society secretary.",
      },
    });
  const risk = await record("risk", {
    kind: "RISK",
    title: "Exit obstructed by deliveries",
    status: "OPEN",
    dueOn: date(7),
    details: {
      likelihood: 3,
      impact: 4,
      assessment: "Staff and volunteers in the community office",
      controls:
        "Keep the entrance clear and check at opening. Mark the delivery area.",
    },
  });
  const plan = await record("plan", {
    kind: "EMERGENCY_PLAN",
    title: "Office evacuation plan",
    status: "ACTIVE",
    dueOn: date(30),
    details: { docId: doc.id, scope: "Kochi office and assembly point" },
  });
  await record("drill", {
    kind: "DRILL",
    title: "Quarterly evacuation practice",
    status: "DONE",
    dueOn: date(-7),
    details: {
      planId: plan.id,
      findings:
        "Everyone reached the assembly point. Signage needs refreshing.",
      actions: "Facilities lead to replace the faded exit sign.",
    },
  });
  await record("review", {
    kind: "SOP_REVIEW",
    title: "Review office evacuation SOP",
    status: "DUE",
    dueOn: date(-2),
    details: {
      docId: doc.id,
      reviewNote:
        "Confirm contacts and assembly point with the operating team.",
    },
  });
  await record("pack", {
    kind: "BOARD_PACK",
    title: "Quarterly safety and governance pack",
    status: "DRAFT",
    startsOn: date(-90),
    endsOn: date(0),
    details: {
      docIds: [doc.id],
      decisionIds: [],
      recordIds: [risk.id, plan.id],
      includeFinance: true,
      currency: "INR",
    },
  });
  // Seed no invented case, incident, acknowledgement or proof file. Committee handlers enter real concerns manually.
}
