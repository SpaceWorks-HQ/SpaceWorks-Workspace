import { createHash } from "node:crypto";

export async function seedMeetingsAndSignatures(prisma, {
  workspaceId,
  ownerId,
  makerId,
  key,
  future,
  end,
}) {
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
  return meeting;
}
