import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { mutatePoll, pollView, closePoll } from "@/lib/polls/service";
import { owner, member, outsider, startsAt, records } from "./fixtures";

export function registerPollVotingTests() {
  it("creates an anonymous poll with delayed results", async () => {
    records.pollId = (
      await mutatePoll(owner, {
        op: "create",
        question: "Which build next?",
        type: "RANKED",
        anonymous: true,
        resultsVisibility: "AFTER_CLOSE",
        options: ["Repair station", "Sensor kit", "Tool library"],
        closesAt: startsAt,
        quorum: { count: 2 },
      })
    ).id;
    const view = await pollView(member, records.pollId);
    expect(view?.tally).toBeNull();
    expect(view?.canVote).toBe(true);
  });
  it("prevents double voting under concurrent requests and keeps the ballot anonymous", async () => {
    const view = (await pollView(member, records.pollId))!;
    const results = await Promise.allSettled([
      mutatePoll(member, {
        op: "vote",
        pollId: records.pollId,
        choices: view.options.map((o) => o.id),
      }),
      mutatePoll(member, {
        op: "vote",
        pollId: records.pollId,
        choices: view.options.map((o) => o.id).reverse(),
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.pollBallotReceipt.count({
        where: { pollId: records.pollId, userId: member.user.id },
      }),
    ).toBe(1);
    const votes = await prisma.pollVote.findMany({ where: { pollId: records.pollId } });
    expect(votes).toHaveLength(1);
    expect(votes[0].voterId).toBeNull();
    expect((await pollView(member, records.pollId))?.hasVoted).toBe(true);
    await mutatePoll(owner, { op: "close", pollId: records.pollId });
    const browserData = JSON.stringify(await pollView(owner, records.pollId));
    for (const secret of [
      "voterId",
      "receipts",
      "votedAt",
      member.user.id,
      "createdAt",
    ])
      expect(browserData).not.toContain(secret);
    expect((await pollView(owner, records.pollId))?.tally).toMatchObject({
      ballots: 1,
      quorumMet: false,
    });
  });
  it("rejects foreign polls, invalid options and ineligible roles", async () => {
    expect(await pollView(outsider, records.pollId)).toBeNull();
    const p = await mutatePoll(owner, {
      op: "create",
      question: "Admin poll",
      type: "SINGLE",
      options: ["A", "B"],
      resultsVisibility: "LIVE",
      closesAt: startsAt,
      eligibility: { type: "ROLE", ref: "ADMIN" },
    });
    expect(await pollView(member, p.id)).toBeNull();
    await expect(
      mutatePoll(member, { op: "vote", pollId: p.id, choices: ["bad"] }),
    ).rejects.toThrow();
    await expect(
      mutatePoll(owner, { op: "vote", pollId: p.id, choices: ["bad"] }),
    ).rejects.toThrow();
  });
  it("serialises closing against a late vote", async () => {
    const p = await mutatePoll(owner, {
      op: "create",
      question: "Close race",
      type: "SINGLE",
      options: ["A", "B"],
      resultsVisibility: "LIVE",
      closesAt: startsAt,
    });
    const option = (await pollView(member, p.id))!.options[0].id;
    await Promise.allSettled([
      closePoll(p.id, owner.workspace.id),
      mutatePoll(member, { op: "vote", pollId: p.id, choices: [option] }),
    ]);
    const view = (await pollView(owner, p.id))!;
    const stored = await prisma.poll.findFirstOrThrow({ where: { id: p.id } });
    expect(view.closed).toBe(true);
    expect((stored.outcome as { ballots: number }).ballots).toBe(
      view.tally?.ballots,
    );
  });
  it("keeps final quorum and eligibility frozen after membership changes", async () => {
    const poll = await mutatePoll(owner, {
      op: "create",
      question: "Frozen result",
      type: "SINGLE",
      options: ["A", "B"],
      resultsVisibility: "AFTER_CLOSE",
      closesAt: startsAt,
      quorum: { percent: 100 },
    });
    const before = (await pollView(owner, poll.id))!;
    await mutatePoll(owner, {
      op: "vote",
      pollId: poll.id,
      choices: [before.options[0].id],
    });
    await mutatePoll(owner, { op: "close", pollId: poll.id });
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          workspaceId: owner.workspace.id,
          userId: member.user.id,
        },
      },
      data: { status: "SUSPENDED" },
    });
    const after = (await pollView(owner, poll.id))!;
    expect(after.eligibleCount).toBe(before.eligibleCount);
    expect(after.tally?.quorumMet).toBe(false);
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          workspaceId: owner.workspace.id,
          userId: member.user.id,
        },
      },
      data: { status: "ACTIVE" },
    });
  });
}
