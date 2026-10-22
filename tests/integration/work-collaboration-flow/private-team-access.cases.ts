import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  mutateMeeting,
  meetingWhere,
  decisionWhere,
} from "@/lib/meetings/service";
import { mutatePoll, pollView } from "@/lib/polls/service";
import {
  suffix,
  owner,
  member,
  projectId,
  startsAt,
  endsAt,
} from "./fixtures";

export function registerPrivateTeamAccessTests() {
  it("applies private-team access to meetings, decisions, polls and action tasks", async () => {
    const team = await prisma.team.create({
      data: {
        workspaceId: owner.workspace.id,
        name: "Private build crew",
        slug: `private-${suffix}`,
        visibility: "PRIVATE",
        members: { create: { userId: owner.user.id } },
      },
    });
    const project = await prisma.project.create({
      data: {
        workspaceId: owner.workspace.id,
        key: "CREW",
        name: "Crew build",
        teamId: team.id,
        ownerId: owner.user.id,
      },
    });
    const meeting = await mutateMeeting(owner, {
      op: "create",
      title: "Crew meeting",
      startsAt,
      endsAt,
      visibility: "TEAM",
      teamId: team.id,
    });
    expect(
      await prisma.meeting.findFirst({
        where: { ...(await meetingWhere(member)), id: meeting.id },
      }),
    ).toBeNull();
    await expect(
      mutateMeeting(owner, {
        op: "attendee",
        meetingId: meeting.id,
        userId: member.user.id,
      }),
    ).rejects.toThrow();
    await mutateMeeting(owner, {
      op: "decision",
      meetingId: meeting.id,
      title: "Crew decision",
      decisionMd: "Only share inside the crew.",
    });
    expect(
      await prisma.decision.count({
        where: {
          AND: [await decisionWhere(member), { meetingId: meeting.id }],
        },
      }),
    ).toBe(0);
    await mutateMeeting(owner, {
      op: "action",
      meetingId: meeting.id,
      projectId: project.id,
      title: "Crew action",
      requestId: "crew-action",
    });
    await expect(
      mutateMeeting(owner, {
        op: "action",
        meetingId: meeting.id,
        projectId,
        title: "Wider audience",
        requestId: "wide-action",
      }),
    ).rejects.toThrow();
    const poll = await mutatePoll(owner, {
      op: "create",
      question: "Crew choice",
      type: "SINGLE",
      options: ["A", "B"],
      resultsVisibility: "LIVE",
      closesAt: startsAt,
      eligibility: { type: "TEAM", ref: team.id },
    });
    expect(await pollView(member, poll.id)).toBeNull();
    expect((await pollView(owner, poll.id))?.canVote).toBe(true);
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: member.user.id },
    });
    const memberPoll = await mutatePoll(member, {
      op: "create",
      question: "A private team question",
      type: "SINGLE",
      options: ["A", "B"],
      resultsVisibility: "LIVE",
      closesAt: startsAt,
      eligibility: { type: "TEAM", ref: team.id },
    });
    await prisma.teamMember.deleteMany({
      where: { teamId: team.id, userId: member.user.id },
    });
    expect(await pollView(member, memberPoll.id)).toBeNull();
    await expect(
      mutatePoll(member, { op: "close", pollId: memberPoll.id }),
    ).rejects.toThrow();
    expect(
      await prisma.searchDocument.findFirst({
        where: {
          workspaceId: owner.workspace.id,
          entityType: "poll",
          entityId: memberPoll.id,
        },
      }),
    ).toMatchObject({ visibility: "TEAM", teamId: team.id });
  });
}
