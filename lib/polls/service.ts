import "server-only";
import { z } from "zod";
import type { Poll, Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { dispatch } from "@/lib/notify";
import { hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import {
  type Actor,
  assertActor,
  ensure,
  id,
  optionalId,
  title,
  text,
  date,
  changed,
  serial,
  jsonObject,
  checkTeam,
  admin,
} from "@/lib/meetings/core";
import { resultsVisible, tallyPoll } from "./tally";
const outcomeSchema = z.object({
  counts: z.record(z.string(), z.number()),
  ballots: z.number(),
  winners: z.array(z.string()),
  rounds: z.array(z.record(z.string(), z.number())),
  quorumMet: z.boolean(),
  eligibleCount: z.number(),
});
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

const eligibilitySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ALL_MEMBERS") }),
  z.object({ type: z.literal("TEAM"), ref: id }),
  z.object({
    type: z.literal("ROLE"),
    ref: z.enum(["MEMBER", "ADMIN", "OWNER"]),
  }),
]);
const quorumSchema = z.union([
  z.object({ count: z.number().int().min(1).max(100_000) }),
  z.object({ percent: z.number().min(1).max(100) }),
]);
export const pollCommand = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("create"),
    question: title,
    descriptionMd: text,
    type: z.enum(["SINGLE", "MULTI", "RANKED"]),
    anonymous: z.boolean().default(false),
    resultsVisibility: z.enum(["LIVE", "AFTER_CLOSE"]),
    options: z.array(title).min(2).max(30),
    eligibility: eligibilitySchema.default({ type: "ALL_MEMBERS" }),
    quorum: quorumSchema.nullish(),
    closesAt: date,
    meetingId: optionalId,
  }),
  z.object({
    op: z.literal("vote"),
    pollId: id,
    choices: z.array(id).min(1).max(30),
  }),
  z.object({ op: z.literal("close"), pollId: id }),
]);

export async function eligibleIds(
  poll: Pick<Poll, "workspaceId" | "eligibility">,
  client: DbClient = prisma,
) {
  const eligibility = jsonObject(poll.eligibility);
  const members = await client.membership.findMany({
    where: {
      workspaceId: poll.workspaceId,
      status: "ACTIVE",
      role: { in: ["MEMBER", "ADMIN", "OWNER"] },
      user: { disabledAt: null },
    },
    select: { userId: true, role: true },
  });
  if (eligibility.type === "TEAM") {
    const team = await client.team.findFirst({
      where: {
        workspaceId: poll.workspaceId,
        id: String(eligibility.ref),
        archivedAt: null,
      },
      include: { members: true },
    });
    return members
      .filter((m) => team?.members.some((t) => t.userId === m.userId))
      .map((m) => m.userId);
  }
  return members
    .filter(
      (m) =>
        eligibility.type !== "ROLE" ||
        hasRoleAtLeast(m.role, eligibility.ref as "MEMBER" | "ADMIN" | "OWNER"),
    )
    .map((m) => m.userId);
}

export async function canReadPoll(
  actor: Actor,
  poll: Poll,
  client: DbClient = prisma,
) {
  if (poll.workspaceId !== actor.workspace.id) return false;
  const eligibility = jsonObject(poll.eligibility);
  if (eligibility.type === "TEAM") {
    const hidden = await hiddenTeamIds(
      actor.workspace.id,
      { userId: actor.user.id, role: actor.membership.role },
      client,
    );
    if (hidden.includes(String(eligibility.ref))) return false;
  }
  if (poll.meetingId) {
    const { meetingWhere } = await import("@/lib/meetings/service");
    if (
      !(await client.meeting.findFirst({
        where: { ...(await meetingWhere(actor, client)), id: poll.meetingId },
      }))
    )
      return false;
  }
  return (
    admin(actor) ||
    poll.createdById === actor.user.id ||
    (await eligibleIds(poll, client)).includes(actor.user.id)
  );
}

/** This DTO is the only poll data passed to the browser, including for admins. */
export async function pollView(
  actor: Actor,
  pollId: string,
  client: DbClient = prisma,
  now = new Date(),
) {
  const poll = await client.poll.findFirst({
    where: { workspaceId: actor.workspace.id, id: pollId },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  });
  if (!poll || !(await canReadPoll(actor, poll, client))) return null;
  const eligible = await eligibleIds(poll, client);
  const hasVoted = !!(await client.pollBallotReceipt.findFirst({
    where: {
      pollId,
      userId: actor.user.id,
      poll: { workspaceId: actor.workspace.id },
    },
    select: { pollId: true },
  }));
  const visible = resultsVisible(
    poll.resultsVisibility,
    poll.closedAt,
    poll.closesAt,
    now,
  );
  const ballots = visible
    ? await client.pollVote.findMany({
        where: { pollId, poll: { workspaceId: actor.workspace.id } },
        select: { choice: true },
      })
    : [];
  const frozen = poll.closedAt ? outcomeSchema.safeParse(poll.outcome) : null;
  const tally = frozen?.success
    ? {
        counts: frozen.data.counts,
        ballots: frozen.data.ballots,
        winners: frozen.data.winners,
        rounds: frozen.data.rounds,
        quorumMet: frozen.data.quorumMet,
      }
    : tallyPoll(
        poll.type,
        poll.options.map((o) => o.id),
        ballots,
        poll.quorum as { count?: number; percent?: number } | null,
        eligible.length,
      );
  return {
    id: poll.id,
    question: poll.question,
    description: poll.descriptionMd,
    type: poll.type,
    anonymous: poll.anonymous,
    resultsVisibility: poll.resultsVisibility,
    closesAt: poll.closesAt?.toISOString() ?? null,
    closed: !!poll.closedAt || !!(poll.closesAt && poll.closesAt <= now),
    options: poll.options.map((o) => ({ id: o.id, label: o.label })),
    eligibleCount: frozen?.success
      ? frozen.data.eligibleCount
      : eligible.length,
    canVote: eligible.includes(actor.user.id),
    hasVoted,
    canClose: admin(actor) || poll.createdById === actor.user.id,
    tally: visible ? tally : null,
  };
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
