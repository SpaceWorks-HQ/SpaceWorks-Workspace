import "server-only";
import { prisma } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { closePoll, eligibleIds } from "@/lib/polls/service";
import { meetingRecipients } from "@/lib/meetings/service";
import { serial } from "@/lib/meetings/core";
import { transitionCycles } from "./collaboration-cycles";

/** Bounded scans; transitions and reminder claims commit with their notification event. */
export async function run(now: Date): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { archivedAt: null },
    select: { id: true, slug: true },
  });
  for (const workspace of workspaces) {
    await transitionCycles(workspace, now);
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
