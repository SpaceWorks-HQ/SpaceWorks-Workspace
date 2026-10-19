import { createHash } from "node:crypto";

/** Layer collaboration examples onto the existing demo workspace. Re-running is safe. */
export default async function seedWorkCollaboration(
  prisma,
  { workspaceId, workspace, users, channels },
) {
  void workspace;
  void users;
  void channels;
  if (process.env.NODE_ENV === "production")
    throw new Error("Demo seeds are for local development only.");
  const members = await prisma.membership.findMany({
    where: {
      workspaceId,
      status: "ACTIVE",
      role: { in: ["OWNER", "ADMIN", "MEMBER"] },
    },
    orderBy: { joinedAt: "asc" },
    select: { userId: true, role: true },
  });
  if (!members.length) return;
  const ownerId =
    members.find((m) => m.role === "OWNER")?.userId ?? members[0].userId;
  const makerId = members.find((m) => m.userId !== ownerId)?.userId ?? ownerId;
  const key = (name) => `${workspaceId}-collab-${name}`;
  const now = new Date();
  const future = new Date(now.getTime() + 3 * 86_400_000);
  const end = new Date(future.getTime() + 3_600_000);
  const meeting = await prisma.meeting.upsert({
    where: { id: key("meeting") },
    create: {
      id: key("meeting"),
      workspaceId,
      title: "Repair night planning",
      startsAt: future,
      endsAt: end,
      location: "The workshop",
      visibility: "WORKSPACE",
      facilitatorId: ownerId,
      createdById: ownerId,
      attendees: {
        create: [
          { userId: ownerId, rsvp: "YES" },
          ...(makerId !== ownerId ? [{ userId: makerId, rsvp: "YES" }] : []),
        ],
      },
      agenda: {
        create: [
          {
            title: "What needs fixing?",
            durationMin: 15,
            sortOrder: 0,
            ownerId: makerId,
          },
          {
            title: "Tools, parts and safety",
            durationMin: 20,
            sortOrder: 1,
            ownerId,
          },
          { title: "Agree the next actions", durationMin: 10, sortOrder: 2 },
        ],
      },
    },
    update: {},
  });
  await prisma.decision.upsert({
    where: { id: key("decision") },
    create: {
      id: key("decision"),
      workspaceId,
      meetingId: meeting.id,
      title: "Repair before replacing",
      contextMd: "We want to use parts already in the workshop.",
      decisionMd: "Check the shared parts shelf before buying new components.",
      deciderIds: [makerId],
      createdById: ownerId,
    },
    update: {},
  });
  await prisma.$transaction(async (tx) => {
    if (await tx.task.findFirst({ where: { workspaceId, id: key("action") } }))
      return;
    const project = await tx.project.findFirst({
      where: { workspaceId, teamId: null, status: { not: "ARCHIVED" } },
      include: {
        columns: {
          where: { category: "TODO" },
          orderBy: { position: "asc" },
          take: 1,
        },
      },
    });
    const [counter] =
      await tx.$queryRaw`INSERT INTO "WorkspaceCounter" ("workspaceId", "name", "value") VALUES (${workspaceId}, 'task', 1) ON CONFLICT ("workspaceId", "name") DO UPDATE SET "value" = "WorkspaceCounter"."value" + 1 RETURNING "value"`;
    const task = await tx.task.create({
      data: {
        id: key("action"),
        workspaceId,
        number: Number(counter.value),
        title: "Prepare a shared parts list",
        sourceMeetingId: meeting.id,
        projectId: project?.id,
        columnId: project?.columns[0]?.id,
        creatorId: ownerId,
        dueAt: future,
        assignees: { create: { userId: makerId } },
      },
    });
    await tx.meetingActionItem.create({
      data: { meetingId: meeting.id, taskId: task.id },
    });
  });
  const doc = await prisma.doc.findFirst({
    where: { workspaceId, visibility: "WORKSPACE", archivedAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (doc) {
    await prisma.meeting.update({
      where: { id: meeting.id, workspaceId },
      data: { notesDocId: doc.id },
    });
    const hash = createHash("sha256")
      .update(JSON.stringify({ title: doc.title, html: doc.contentHtml }))
      .digest("hex");
    const request = await prisma.signatureRequest.upsert({
      where: { id: key("signature") },
      create: {
        id: key("signature"),
        workspaceId,
        docId: doc.id,
        contentHash: hash,
        signerUserId: makerId,
        createdById: ownerId,
      },
      update: {},
    });
    if (
      !(await prisma.activityEvent.findFirst({
        where: {
          workspaceId,
          entityType: "signature_snapshot",
          entityId: request.id,
        },
      }))
    )
      await prisma.activityEvent.create({
        data: {
          workspaceId,
          actorId: makerId,
          entityType: "signature_snapshot",
          entityId: request.id,
          verb: "requested",
          summary: "Document acknowledgement requested",
          visibility: "PRIVATE",
          data: { title: doc.title, html: doc.contentHtml },
        },
      });
  }
  await prisma.poll.upsert({
    where: { id: key("poll") },
    create: {
      id: key("poll"),
      workspaceId,
      question: "What should we build after repair night?",
      type: "RANKED",
      anonymous: true,
      resultsVisibility: "AFTER_CLOSE",
      closesAt: future,
      quorum: { count: 2 },
      createdById: ownerId,
      options: {
        create: ["A shared tool library", "A sensor kit", "A repair guide"].map(
          (label, sortOrder) => ({ label, sortOrder }),
        ),
      },
    },
    update: {},
  });
  for (const [name, title, bodyMd, status] of [
    [
      "idea-one",
      "Build a labelled parts shelf",
      "A home for spare motors, sensors and fasteners.",
      "NEW",
    ],
    [
      "idea-two",
      "Write a first-time maker guide",
      "Collect the small things we wish we knew on day one.",
      "PLANNED",
    ],
  ]) {
    const idea = await prisma.idea.upsert({
      where: { id: key(name) },
      create: {
        id: key(name),
        workspaceId,
        title,
        bodyMd,
        status,
        authorId: makerId,
        tags: ["workshop"],
      },
      update: {},
    });
    await prisma.ideaVote.upsert({
      where: { ideaId_userId: { ideaId: idea.id, userId: ownerId } },
      create: { ideaId: idea.id, userId: ownerId },
      update: {},
    });
  }
  const year = now.getUTCFullYear(),
    quarter = Math.floor(now.getUTCMonth() / 3) * 3;
  const goal = await prisma.goal.upsert({
    where: { id: key("goal") },
    create: {
      id: key("goal"),
      workspaceId,
      title: "Make community repair a habit",
      description:
        "Help members fix things together and share what they learn.",
      ownerId: makerId,
      periodStart: new Date(Date.UTC(year, quarter, 1)),
      periodEnd: new Date(Date.UTC(year, quarter + 3, 0)),
      keyResults: {
        create: [
          {
            title: "Host repair nights",
            metricType: "NUMBER",
            start: 0,
            target: 6,
            current: 2,
            sortOrder: 0,
            checkIns: [
              {
                at: now.toISOString(),
                value: 2,
                note: "Two evenings, plenty of shared learning.",
                confidence: "HIGH",
                by: makerId,
              },
            ],
          },
          {
            title: "Publish a repair guide",
            metricType: "BOOLEAN",
            target: 1,
            sortOrder: 1,
          },
        ],
      },
    },
    update: {},
  });
  void goal;
  for (const kind of ["DOC", "PROJECT", "TASK", "MEETING"])
    await prisma.template.upsert({
      where: { id: key(`template-${kind.toLowerCase()}`) },
      create: {
        id: key(`template-${kind.toLowerCase()}`),
        workspaceId,
        kind,
        name:
          kind === "MEETING"
            ? "Weekly build review"
            : `${kind === "DOC" ? "Document" : kind === "PROJECT" ? "Project" : "Task"} starter`,
        description: "A useful starting point for the next community build.",
        createdById: ownerId,
        content: {
          title: "Community build {{date}}",
          text: "What we want to make\nWhat we need\nNext actions",
          ...(kind === "MEETING"
            ? {
                agenda: [
                  "Progress since last time",
                  "Decisions needed",
                  "Next actions",
                ],
              }
            : {}),
        },
      },
      update: {},
    });
  await prisma.changelogEntry.upsert({
    where: { id: key("release") },
    create: {
      id: key("release"),
      workspaceId,
      title: "The shared parts shelf is ready",
      bodyMd:
        "Find spare components at the workshop. Please label anything you add and return unused parts after a build.",
      version: "2026.1",
      tags: ["workshop", "reuse"],
      publishedAt: now,
      createdById: ownerId,
    },
    update: {},
  });
  const project = await prisma.project.findFirst({
    where: { workspaceId, cyclesEnabled: true, status: { not: "ARCHIVED" } },
  });
  if (project) {
    const max = await prisma.cycle.aggregate({
      where: { workspaceId, projectId: project.id },
      _max: { number: true },
    });
    const cycle = await prisma.cycle.upsert({
      where: { id: key("cycle") },
      create: {
        id: key("cycle"),
        workspaceId,
        projectId: project.id,
        teamId: project.teamId,
        number: (max._max.number ?? 0) + 1,
        name: "Ready for repair night",
        goal: "Prepare the tools and shared parts.",
        startsAt: now,
        endsAt: future,
        status: "ACTIVE",
      },
      update: {},
    });
    const task = await prisma.task.findFirst({
      where: {
        workspaceId,
        projectId: project.id,
        archivedAt: null,
        completedAt: null,
        cycleId: null,
      },
    });
    if (task)
      await prisma.task.updateMany({
        where: { workspaceId, id: task.id, cycleId: null },
        data: { cycleId: cycle.id },
      });
  }
  const slug = (
    await prisma.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { slug: true },
    })
  ).slug;
  for (const [type, rows, route, body] of [
    ["meeting", [meeting], "meetings", ""],
    ["goal", [goal], "goals", goal.description ?? ""],
  ])
    for (const row of rows)
      await prisma.searchDocument.upsert({
        where: { entityType_entityId: { entityType: type, entityId: row.id } },
        create: {
          workspaceId,
          entityType: type,
          entityId: row.id,
          title: row.title,
          body,
          url: `/w/${slug}/${route}/${row.id}`,
          ownerId,
        },
        update: {},
      });
}
