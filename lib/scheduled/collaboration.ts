import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { closePoll, eligibleIds } from "@/lib/polls/service";
import { meetingRecipients } from "@/lib/meetings/service";
import { serial } from "@/lib/meetings/core";
import { recordActivity } from "@/lib/activity";
import { projectViewerIds } from "@/lib/tasks/access";

/** Bounded scans; transitions and reminder claims commit with their notification event. */
export async function run(now: Date): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { archivedAt: null },
    select: { id: true, slug: true },
  });
  for (const workspace of workspaces) {
    const cycles = await prisma.cycle.findMany({
      where: {
        workspaceId: workspace.id,
        status: { in: ["UPCOMING", "ACTIVE"] },
        startsAt: { lte: now },
        project: { cyclesEnabled: true, status: { not: "ARCHIVED" } },
      },
      orderBy: { startsAt: "asc" },
      take: 50,
    });
    for (const candidate of cycles) {
      const notification = await serial(async (tx) => {
        const cycle = await tx.cycle.findFirst({
          where: { workspaceId: workspace.id, id: candidate.id },
          include: {
            tasks: { where: { workspaceId: workspace.id } },
            project: true,
          },
        });
        if (!cycle || cycle.status === "COMPLETED") return null;
        let type: "cycle.started" | "cycle.completed";
        if (cycle.endsAt <= now) {
          const next = await tx.cycle.findFirst({
            where: {
              workspaceId: workspace.id,
              projectId: cycle.projectId,
              id: { not: cycle.id },
              status: { not: "COMPLETED" },
              endsAt: { gt: now },
            },
            orderBy: { startsAt: "asc" },
          });
          await recordActivity(
            {
              workspaceId: workspace.id,
              entityType: "cycle_review",
              entityId: cycle.id,
              verb: "completed",
              summary: `Cycle ${cycle.number} completed`,
              projectId: cycle.projectId,
              teamId: cycle.teamId,
              data: {
                review: "Completed at the scheduled end time.",
                carriedToId: next?.id ?? null,
                tasks: cycle.tasks.map((t) => ({
                  id: t.id,
                  title: t.title,
                  createdAt: t.createdAt.toISOString(),
                  completedAt: t.completedAt?.toISOString() ?? null,
                  archivedAt: t.archivedAt?.toISOString() ?? null,
                })),
              },
            },
            tx,
          );
          if (next)
            await tx.task.updateMany({
              where: {
                workspaceId: workspace.id,
                cycleId: cycle.id,
                completedAt: null,
                archivedAt: null,
              },
              data: { cycleId: next.id },
            });
          await tx.cycle.updateMany({
            where: {
              workspaceId: workspace.id,
              id: cycle.id,
              status: { not: "COMPLETED" },
            },
            data: { status: "COMPLETED" },
          });
          type = "cycle.completed";
        } else {
          if (
            cycle.status !== "UPCOMING" ||
            (await tx.cycle.findFirst({
              where: {
                workspaceId: workspace.id,
                projectId: cycle.projectId,
                status: "ACTIVE",
              },
            }))
          )
            return null;
          await tx.cycle.updateMany({
            where: {
              workspaceId: workspace.id,
              id: cycle.id,
              status: "UPCOMING",
            },
            data: { status: "ACTIVE" },
          });
          type = "cycle.started";
        }
        return dispatch(
          workspace.id,
          {
            type,
            title:
              type === "cycle.started"
                ? "A project cycle has started"
                : "A project cycle is complete",
            recipients: [
              ...(await projectViewerIds(workspace.id, cycle.project, tx)),
            ],
            useWorkspaceRules: false,
            scope: cycle.projectId ? { projectId: cycle.projectId } : {},
            url: `/w/${workspace.slug}/cycles/${cycle.id}`,
            resource: { type: "cycle", id: cycle.id },
            data: { cycleId: cycle.id, projectId: cycle.projectId },
          },
          { tx, now },
        );
      });
      await notification?.afterCommit();
    }
    const closing = await prisma.poll.findMany({
      where: {
        workspaceId: workspace.id,
        closedAt: null,
        closesAt: { lte: now },
      },
      select: { id: true },
      take: 50,
    });
    for (const poll of closing) await closePoll(poll.id, workspace.id, now);
    const soon = await prisma.poll.findMany({
      where: {
        workspaceId: workspace.id,
        closedAt: null,
        closesAt: { gt: now, lte: new Date(now.getTime() + 86_400_000) },
      },
      take: 50,
    });
    for (const poll of soon)
      await remind(`poll-soon:${poll.id}`, workspace.id, async (tx) => {
        const receipts = await tx.pollBallotReceipt.findMany({
          where: { pollId: poll.id, poll: { workspaceId: workspace.id } },
          select: { userId: true },
        });
        return dispatch(
          workspace.id,
          {
            type: "poll.closing_soon",
            title: "A poll closes soon",
            recipients: (await eligibleIds(poll, tx)).filter(
              (id) => !receipts.some((r) => r.userId === id),
            ),
            useWorkspaceRules: false,
            url: `/w/${workspace.slug}/polls/${poll.id}`,
            data: {
              pollId: poll.id,
              closesAt: poll.closesAt?.toISOString() ?? null,
            },
          },
          { tx, now },
        );
      });
    const meetings = await prisma.meeting.findMany({
      where: {
        workspaceId: workspace.id,
        status: "SCHEDULED",
        startsAt: { gt: now, lte: new Date(now.getTime() + 86_400_000) },
      },
      include: { attendees: { select: { userId: true, rsvp: true } } },
      take: 50,
    });
    for (const meeting of meetings)
      await remind(
        `agenda:${meeting.id}:${meeting.startsAt.toISOString()}`,
        workspace.id,
        async (tx) => {
          const viewers = await meetingRecipients(meeting, tx);
          return dispatch(
            workspace.id,
            {
              type: "meeting.agenda_reminder",
              title: "Add topics before your meeting",
              recipients: meeting.attendees
                .filter(
                  (a) =>
                    a.userId && a.rsvp !== "NO" && viewers.includes(a.userId),
                )
                .map((a) => a.userId!),
              useWorkspaceRules: false,
              scope: { meetingId: meeting.id },
              url: `/w/${workspace.slug}/meetings/${meeting.id}`,
              data: {
                meetingId: meeting.id,
                startsAt: meeting.startsAt.toISOString(),
              },
            },
            { tx, now },
          );
        },
      );
    const goals = await prisma.goal.findMany({
      where: {
        workspaceId: workspace.id,
        status: { not: "DONE" },
        periodStart: { lte: now },
        periodEnd: { gte: now },
        OR: [
          { lastCheckInAt: null },
          { lastCheckInAt: { lte: new Date(now.getTime() - 7 * 86_400_000) } },
        ],
      },
      take: 50,
    });
    for (const goal of goals)
      await remind(
        `goal:${goal.id}:${Math.floor(now.getTime() / (7 * 86_400_000))}`,
        workspace.id,
        (tx) =>
          dispatch(
            workspace.id,
            {
              type: "goal.check_in_due",
              title: "Your objective is ready for a check-in",
              recipients: goal.ownerId ? [goal.ownerId] : [],
              useWorkspaceRules: false,
              url: `/w/${workspace.slug}/goals/${goal.id}`,
              data: { goalId: goal.id },
            },
            { tx, now },
          ),
      );
    const requests = await prisma.signatureRequest.findMany({
      where: {
        workspaceId: workspace.id,
        status: "PENDING",
        createdAt: { lte: new Date(now.getTime() - 86_400_000) },
        doc: { archivedAt: null },
      },
      include: { doc: { select: { visibility: true } } },
      take: 50,
    });
    for (const request of requests)
      await remind(
        `signature:${request.id}:${now.toISOString().slice(0, 10)}`,
        workspace.id,
        async (tx) => {
          const signer = request.signerUserId
            ? await tx.membership.findFirst({
                where: {
                  workspaceId: workspace.id,
                  userId: request.signerUserId,
                  status: "ACTIVE",
                  user: { disabledAt: null },
                  ...(request.doc.visibility === "ADMINS"
                    ? { role: { in: ["OWNER", "ADMIN"] } }
                    : {}),
                },
              })
            : null;
          return dispatch(
            workspace.id,
            {
              type: "signature.requested",
              title: "Please acknowledge a document",
              recipients: signer ? [signer.userId] : [],
              useWorkspaceRules: false,
              url: `/w/${workspace.slug}/sign/${request.id}`,
              data: { signatureRequestId: request.id, docId: request.docId },
            },
            { tx, now },
          );
        },
      );
  }
}

async function remind(
  key: string,
  workspaceId: string,
  send: (
    tx: import("@/lib/db").Tx,
  ) => Promise<import("@/lib/notify/types").DispatchResult>,
) {
  const result = await serial(async (tx) => {
    if (
      await tx.recordLink.findFirst({
        where: {
          workspaceId,
          fromType: "collaboration_reminder",
          fromId: key,
          toType: "notification",
        },
      })
    )
      return null;
    const notification = await send(tx);
    await tx.recordLink.create({
      data: {
        workspaceId,
        fromType: "collaboration_reminder",
        fromId: key,
        toType: "notification",
        toId: notification.eventId,
      },
    });
    return notification;
  });
  await result?.afterCommit();
}
