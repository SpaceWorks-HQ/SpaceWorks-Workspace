import "server-only";
import type { Poll, Prisma } from "@prisma/client";
import { dispatch } from "@/lib/notify";
import {
  type Actor,
  assertActor,
  ensure,
  changed,
  serial,
  jsonObject,
  checkTeam,
  admin,
} from "@/lib/meetings/core";
import { tallyPoll } from "./tally";
import { pollCommand } from "./validation";
import { canReadPoll, eligibleIds } from "./queries";

function pollIndexScope(poll: Pick<Poll, "eligibility" | "createdById">) {
  const eligibility = jsonObject(poll.eligibility);
  return eligibility.type === "TEAM" && typeof eligibility.ref === "string"
    ? {
        visibility: "TEAM" as const,
        teamId: eligibility.ref,
        ownerId: poll.createdById,
      }
    : { visibility: "PRIVATE" as const, ownerId: poll.createdById };
}

export async function closePoll(
  pollId: string,
  workspaceId: string,
  now = new Date(),
  actor?: Actor,
) {
  const result = await serial(async (tx) => {
    if (actor) await assertActor(actor, tx);
    const poll = await tx.poll.findFirst({
      where: { workspaceId, id: pollId },
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
    ensure(poll);
    if (actor)
      ensure(
        (await canReadPoll(actor, poll, tx)) &&
          (admin(actor) || poll.createdById === actor.user.id),
      );
    if (poll.closedAt) return null;
    const ballots = await tx.pollVote.findMany({
      where: { pollId, poll: { workspaceId } },
      select: { choice: true },
    });
    const eligibleCount = (await eligibleIds(poll, tx)).length;
    const outcome = {
      ...tallyPoll(
        poll.type,
        poll.options.map((o) => o.id),
        ballots,
        poll.quorum as { count?: number; percent?: number } | null,
        eligibleCount,
      ),
      eligibleCount,
    };
    await tx.poll.updateMany({
      where: { workspaceId, id: pollId, closedAt: null },
      data: {
        closedAt: now,
        outcome: outcome as unknown as Prisma.InputJsonValue,
      },
    });
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    });
    if (actor)
      await changed(
        tx,
        actor,
        "poll",
        poll.id,
        poll.question,
        `polls/${poll.id}`,
        "closed",
        "",
        pollIndexScope(poll),
      );
    return dispatch(
      workspaceId,
      {
        type: "poll.closed",
        title: "Poll closed",
        actorId: actor?.user.id,
        recipients: await eligibleIds(poll, tx),
        useWorkspaceRules: false,
        url: `/w/${workspace.slug}/polls/${poll.id}`,
        resource: { type: "poll", id: poll.id },
        data: {
          pollId: poll.id,
          closesAt: poll.closesAt?.toISOString() ?? null,
        },
      },
      { tx, now },
    );
  });
  await result?.afterCommit();
  return { id: pollId };
}

export async function mutatePoll(actor: Actor, input: unknown) {
  const data = pollCommand.parse(input);
  if (data.op === "close")
    return closePoll(data.pollId, actor.workspace.id, new Date(), actor);
  const result = await serial(async (tx) => {
    await assertActor(actor, tx);
    if (data.op === "create") {
      ensure(
        data.closesAt > new Date(),
        "Choose a closing time in the future.",
      );
      ensure(
        new Set(data.options.map((s) => s.toLowerCase())).size ===
          data.options.length,
        "Give each option a different label.",
      );
      if (data.eligibility.type === "TEAM")
        await checkTeam(actor, data.eligibility.ref, tx);
      if (data.meetingId) {
        const { meetingWhere } = await import("@/lib/meetings/service");
        const meeting = await tx.meeting.findFirst({
          where: { ...(await meetingWhere(actor, tx)), id: data.meetingId },
        });
        ensure(
          meeting &&
            (meeting.visibility === "WORKSPACE" ||
              (data.eligibility.type === "TEAM" &&
                data.eligibility.ref === meeting.teamId)),
          "Match the poll eligibility to the meeting's audience.",
        );
      }
      const poll = await tx.poll.create({
        data: {
          workspaceId: actor.workspace.id,
          question: data.question,
          descriptionMd: data.descriptionMd,
          type: data.type,
          anonymous: data.anonymous,
          resultsVisibility: data.resultsVisibility,
          eligibility: data.eligibility,
          quorum: data.quorum ?? undefined,
          closesAt: data.closesAt,
          meetingId: data.meetingId,
          createdById: actor.user.id,
          options: {
            create: data.options.map((label, sortOrder) => ({
              label,
              sortOrder,
            })),
          },
        },
      });
      await changed(
        tx,
        actor,
        "poll",
        poll.id,
        poll.question,
        `polls/${poll.id}`,
        "created",
        "",
        pollIndexScope(poll),
      );
      const notification = await dispatch(
        actor.workspace.id,
        {
          type: "poll.opened",
          title: "A poll is ready for your vote",
          actorId: actor.user.id,
          recipients: await eligibleIds(poll, tx),
          useWorkspaceRules: false,
          url: `/w/${actor.workspace.slug}/polls/${poll.id}`,
          resource: { type: "poll", id: poll.id },
          data: {
            pollId: poll.id,
            closesAt: poll.closesAt?.toISOString() ?? null,
          },
        },
        { tx },
      );
      return { id: poll.id, notification };
    }
    const poll = await tx.poll.findFirst({
      where: { workspaceId: actor.workspace.id, id: data.pollId },
      include: { options: true },
    });
    ensure(poll && (await canReadPoll(actor, poll, tx)));
    ensure(
      !poll.closedAt && (!poll.closesAt || poll.closesAt > new Date()),
      "This poll is closed.",
    );
    ensure((await eligibleIds(poll, tx)).includes(actor.user.id));
    ensure(
      new Set(data.choices).size === data.choices.length &&
        data.choices.every((choice) =>
          poll.options.some((o) => o.id === choice),
        ),
      "Choose valid options without repeats.",
    );
    ensure(
      poll.type !== "SINGLE" || data.choices.length === 1,
      "Choose one option.",
    );
    ensure(
      !(await tx.pollBallotReceipt.findFirst({
        where: {
          pollId: poll.id,
          userId: actor.user.id,
          poll: { workspaceId: actor.workspace.id },
        },
      })),
      "Your vote has already been recorded.",
    );
    await tx.pollBallotReceipt.create({
      data: { pollId: poll.id, userId: actor.user.id },
    });
    await tx.pollVote.create({
      data: {
        pollId: poll.id,
        voterId: poll.anonymous ? null : actor.user.id,
        choice: data.choices,
      },
    });
    // A secret ballot never writes an actor/choice pair to audit, search, activity or notifications.
    return { id: poll.id, notification: null };
  });
  await result.notification?.afterCommit();
  return { id: result.id };
}
