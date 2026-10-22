import "server-only";
import type { Poll } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/db";
import { hasRoleAtLeast } from "@/lib/roles";
import { hiddenTeamIds } from "@/lib/teamAccess";
import { type Actor, jsonObject, admin } from "@/lib/meetings/core";
import { resultsVisible, tallyPoll } from "./tally";
import { outcomeSchema } from "./validation";

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
