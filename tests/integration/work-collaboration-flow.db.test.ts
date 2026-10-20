import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  mutateMeeting,
  meetingWhere,
  decisionWhere,
} from "@/lib/meetings/service";
import { mutateCycle } from "@/lib/cycles/service";
import { mutateGoal } from "@/lib/goals/service";
import { mutatePoll, pollView, closePoll } from "@/lib/polls/service";
import { mutateIdea } from "@/lib/ideas/service";
import { mutateTemplate } from "@/lib/templates/service";
import {
  mutateSignature,
  signatureView,
  contentHash,
} from "@/lib/signatures/service";
import { mutateChangelog } from "@/lib/changelog/service";
import { run } from "@/lib/scheduled/collaboration";
import type { Actor } from "@/lib/meetings/core";
import {
  addMember,
  cleanup,
  createUser,
  createWorkspace,
  uniqueSuffix,
} from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@collaboration-${suffix}.test`;
const slugs = [`collaboration-a-${suffix}`, `collaboration-b-${suffix}`];
let owner: Actor, member: Actor, guest: Actor, outsider: Actor;
let projectId: string,
  meetingId: string,
  foreignMeetingId: string,
  docId: string,
  pollId: string,
  cycleId: string,
  nextCycleId: string,
  goalId: string;
const startsAt = new Date(Date.now() + 2 * 86_400_000);
const endsAt = new Date(startsAt.getTime() + 3_600_000);

async function actor(userId: string, workspaceId: string): Promise<Actor> {
  const [user, workspace, membership] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    prisma.membership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId, workspaceId } },
    }),
  ]);
  return { user, workspace, membership };
}
describe.sequential("work collaboration: tenant-safe workflows", () => {
  beforeAll(async () => {
    const [a, b, c, d] = await Promise.all([
      createUser(`owner${domain}`, "Owner"),
      createUser(`member${domain}`, "Maker"),
      createUser(`guest${domain}`, "Guest"),
      createUser(`outsider${domain}`, "Outsider"),
    ]);
    const first = await createWorkspace(slugs[0], a.id),
      second = await createWorkspace(slugs[1], d.id);
    await addMember(first.id, b.id);
    await addMember(first.id, c.id, "GUEST");
    owner = await actor(a.id, first.id);
    member = await actor(b.id, first.id);
    guest = await actor(c.id, first.id);
    outsider = await actor(d.id, second.id);
    const project = await prisma.project.create({
      data: {
        workspaceId: first.id,
        key: "BUILD",
        name: "Community build",
        ownerId: a.id,
        cyclesEnabled: true,
        columns: { create: { name: "To do", position: 0 } },
      },
    });
    projectId = project.id;
    const doc = await prisma.doc.create({
      data: {
        workspaceId: first.id,
        title: "Workshop agreement",
        contentHtml: "<p>Keep the space ready for the next maker.</p>",
        contentText: "Keep the space ready for the next maker.",
        createdById: a.id,
      },
    });
    docId = doc.id;
    meetingId = (
      await mutateMeeting(owner, {
        op: "create",
        title: "Build review",
        startsAt,
        endsAt,
        attendeeIds: [member.user.id],
      })
    ).id;
    foreignMeetingId = (
      await mutateMeeting(outsider, {
        op: "create",
        title: "Other workspace",
        startsAt,
        endsAt,
      })
    ).id;
  });
  afterAll(async () => {
    await cleanup(slugs, domain);
  });

  it("creates a meeting action and its assigned task atomically, with retry protection", async () => {
    const input = {
      op: "action",
      meetingId,
      title: "Order reusable components",
      projectId,
      assigneeId: member.user.id,
      dueAt: endsAt,
      requestId: "order-parts",
    };
    await mutateMeeting(owner, input);
    await mutateMeeting(owner, input);
    const tasks = await prisma.task.findMany({
      where: { workspaceId: owner.workspace.id, sourceMeetingId: meetingId },
      include: { assignees: true, meetingActionLinks: true },
    });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: input.title,
      dueAt: endsAt,
      projectId,
    });
    expect(tasks[0].assignees[0].userId).toBe(member.user.id);
    expect(tasks[0].meetingActionLinks).toHaveLength(1);
    expect(
      await prisma.notification.count({
        where: {
          workspaceId: owner.workspace.id,
          userId: member.user.id,
          kind: "task.assigned",
        },
      }),
    ).toBe(1);
  });
  it("never accepts foreign meetings, assignees or projects for action items", async () => {
    await expect(
      mutateMeeting(owner, {
        op: "action",
        meetingId: foreignMeetingId,
        title: "Foreign action",
        requestId: "foreign",
      }),
    ).rejects.toThrow();
    await expect(
      mutateMeeting(owner, {
        op: "action",
        meetingId,
        title: "Foreign assignee",
        assigneeId: outsider.user.id,
        requestId: "foreign-user",
      }),
    ).rejects.toThrow();
    await expect(
      mutateMeeting(owner, {
        op: "action",
        meetingId,
        title: "Foreign project",
        projectId: "missing",
        requestId: "foreign-project",
      }),
    ).rejects.toThrow();
  });
  it("records searchable decisions, preserving workspace and meeting visibility", async () => {
    await mutateMeeting(owner, {
      op: "decision",
      meetingId,
      title: "Use shared parts",
      contextMd: "Reduce waste",
      decisionMd: "Reuse stock before ordering.",
      ownerId: member.user.id,
    });
    const decisions = await prisma.decision.findMany({
      where: await decisionWhere(owner),
    });
    expect(decisions.some((d) => d.title === "Use shared parts")).toBe(true);
    expect(
      await prisma.decision.count({
        where: { AND: [await decisionWhere(outsider), { meetingId }] },
      }),
    ).toBe(0);
    expect(
      await prisma.searchDocument.count({
        where: {
          workspaceId: owner.workspace.id,
          entityType: "decision",
          body: { contains: "Reuse stock" },
        },
      }),
    ).toBe(1);
  });
  it("hides private meetings and decisions even from other contributors", async () => {
    const privateMeeting = await mutateMeeting(owner, {
      op: "create",
      title: "Private planning",
      startsAt,
      endsAt,
      visibility: "PRIVATE",
    });
    await mutateMeeting(owner, {
      op: "decision",
      meetingId: privateMeeting.id,
      title: "Private outcome",
      decisionMd: "Only the owner should see this.",
    });
    expect(
      await prisma.meeting.findFirst({
        where: { ...(await meetingWhere(member)), id: privateMeeting.id },
      }),
    ).toBeNull();
    expect(
      await prisma.decision.count({
        where: {
          AND: [await decisionWhere(member), { meetingId: privateMeeting.id }],
        },
      }),
    ).toBe(0);
    await expect(
      mutateMeeting(owner, {
        op: "action",
        meetingId: privateMeeting.id,
        title: "Must stay private",
        requestId: "private-action",
      }),
    ).rejects.toThrow();
  });
  it("rejects guest changes while allowing an invited guest to RSVP", async () => {
    await expect(
      mutateMeeting(guest, { op: "agenda", meetingId, title: "Guest edit" }),
    ).rejects.toThrow();
    await mutateMeeting(owner, {
      op: "attendee",
      meetingId,
      userId: guest.user.id,
    });
    await mutateMeeting(guest, { op: "rsvp", meetingId, rsvp: "YES" });
    expect(
      await prisma.meetingAttendee.findFirst({
        where: { meetingId, userId: guest.user.id },
      }),
    ).toMatchObject({ rsvp: "YES" });
  });
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
  it("orders and edits agenda items with tenant checks", async () => {
    await mutateMeeting(member, {
      op: "agenda",
      meetingId,
      title: "Progress",
      durationMin: 15,
    });
    await mutateMeeting(owner, {
      op: "agenda",
      meetingId,
      title: "Next build",
      durationMin: 10,
    });
    const agenda = await prisma.agendaItem.findMany({
      where: { meetingId },
      orderBy: { sortOrder: "asc" },
    });
    await mutateMeeting(owner, {
      op: "reorder",
      meetingId,
      agendaIds: agenda.map((a) => a.id).reverse(),
    });
    expect(
      (
        await prisma.agendaItem.findMany({
          where: { meetingId },
          orderBy: { sortOrder: "asc" },
        })
      )[0].title,
    ).toBe("Next build");
    await expect(
      mutateMeeting(owner, {
        op: "reorder",
        meetingId,
        agendaIds: [agenda[0].id, "foreign"],
      }),
    ).rejects.toThrow();
  });
  it("materialises finite recurring series and meeting templates", async () => {
    const template = await mutateTemplate(owner, {
      op: "create",
      kind: "MEETING",
      name: "Weekly review",
      title: "Review",
      text: "Progress\nDecisions\nNext actions",
    });
    const root = await mutateMeeting(owner, {
      op: "create",
      title: "Weekly review",
      startsAt,
      endsAt,
      repeat: "WEEKLY",
      occurrences: 3,
      templateId: template.id,
    });
    const series = await prisma.meeting.findMany({
      where: { workspaceId: owner.workspace.id, seriesId: root.id },
      include: { agenda: true },
    });
    expect(series).toHaveLength(3);
    expect(series.every((m) => m.agenda.length === 3)).toBe(true);
  });
  it("creates an anonymous poll with delayed results", async () => {
    pollId = (
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
    const view = await pollView(member, pollId);
    expect(view?.tally).toBeNull();
    expect(view?.canVote).toBe(true);
  });
  it("prevents double voting under concurrent requests and keeps the ballot anonymous", async () => {
    const view = (await pollView(member, pollId))!;
    const results = await Promise.allSettled([
      mutatePoll(member, {
        op: "vote",
        pollId,
        choices: view.options.map((o) => o.id),
      }),
      mutatePoll(member, {
        op: "vote",
        pollId,
        choices: view.options.map((o) => o.id).reverse(),
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      await prisma.pollBallotReceipt.count({
        where: { pollId, userId: member.user.id },
      }),
    ).toBe(1);
    const votes = await prisma.pollVote.findMany({ where: { pollId } });
    expect(votes).toHaveLength(1);
    expect(votes[0].voterId).toBeNull();
    expect((await pollView(member, pollId))?.hasVoted).toBe(true);
    await mutatePoll(owner, { op: "close", pollId });
    const browserData = JSON.stringify(await pollView(owner, pollId));
    for (const secret of [
      "voterId",
      "receipts",
      "votedAt",
      member.user.id,
      "createdAt",
    ])
      expect(browserData).not.toContain(secret);
    expect((await pollView(owner, pollId))?.tally).toMatchObject({
      ballots: 1,
      quorumMet: false,
    });
  });
  it("rejects foreign polls, invalid options and ineligible roles", async () => {
    expect(await pollView(outsider, pollId)).toBeNull();
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
  it("carries unfinished cycle tasks, leaving a complete review snapshot", async () => {
    cycleId = (
      await mutateCycle(owner, {
        op: "create",
        projectId,
        name: "First cycle",
        startsAt,
        endsAt,
      })
    ).id;
    nextCycleId = (
      await mutateCycle(owner, {
        op: "create",
        projectId,
        name: "Next cycle",
        startsAt: endsAt,
        endsAt: new Date(endsAt.getTime() + 86_400_000),
      })
    ).id;
    const task = await prisma.task.findFirstOrThrow({
      where: { workspaceId: owner.workspace.id, sourceMeetingId: meetingId },
    });
    await mutateCycle(owner, { op: "assign", cycleId, taskId: task.id });
    await mutateCycle(owner, { op: "start", cycleId });
    await mutateCycle(owner, {
      op: "complete",
      cycleId,
      carryToId: nextCycleId,
      review: "We agreed the component list.",
    });
    expect(
      await prisma.task.findUnique({ where: { id: task.id } }),
    ).toMatchObject({ cycleId: nextCycleId });
    expect(
      await prisma.activityEvent.findFirst({
        where: {
          workspaceId: owner.workspace.id,
          entityType: "cycle_review",
          entityId: cycleId,
        },
      }),
    ).toMatchObject({
      data: {
        review: "We agreed the component list.",
        tasks: [{ id: task.id }],
      },
    });
    await expect(
      mutateCycle(outsider, { op: "start", cycleId: nextCycleId }),
    ).rejects.toThrow();
  });
  it("records confidence-bearing OKR check-ins and rejects foreign results", async () => {
    goalId = (
      await mutateGoal(owner, {
        op: "create",
        title: "Make repair easier",
        periodStart: new Date("2026-10-01"),
        periodEnd: new Date("2026-12-31"),
        ownerId: member.user.id,
      })
    ).id;
    await mutateGoal(member, {
      op: "result",
      goalId,
      title: "Repair sessions",
      metricType: "NUMBER",
      start: 0,
      target: 10,
    });
    const result = await prisma.keyResult.findFirstOrThrow({
      where: { goalId },
    });
    await mutateGoal(member, {
      op: "checkin",
      goalId,
      resultId: result.id,
      value: 4,
      note: "Four sessions complete",
      confidence: "MEDIUM",
    });
    expect(
      await prisma.goal.findUnique({ where: { id: goalId } }),
    ).toMatchObject({ status: "AT_RISK" });
    expect(
      await prisma.keyResult.findUnique({ where: { id: result.id } }),
    ).toMatchObject({
      current: 4,
      checkIns: [{ confidence: "MEDIUM", by: member.user.id }],
    });
    await expect(
      mutateGoal(outsider, {
        op: "checkin",
        goalId,
        resultId: result.id,
        value: 9,
        confidence: "HIGH",
      }),
    ).rejects.toThrow();
  });
  it("merges duplicate ideas and overlapping votes without losing discussion", async () => {
    const a = await mutateIdea(member, { op: "create", title: "Repair shelf" }),
      b = await mutateIdea(owner, { op: "create", title: "A repair shelf" });
    for (const ideaId of [a.id, b.id])
      await mutateIdea(member, { op: "vote", ideaId });
    await mutateIdea(owner, { op: "vote", ideaId: b.id });
    await mutateIdea(member, {
      op: "comment",
      ideaId: a.id,
      body: "We have spare timber.",
    });
    await mutateIdea(owner, { op: "merge", ideaId: a.id, targetId: b.id });
    expect(await prisma.ideaVote.count({ where: { ideaId: b.id } })).toBe(2);
    expect(
      await prisma.activityEvent.count({
        where: {
          workspaceId: owner.workspace.id,
          entityType: "idea_comment",
          entityId: a.id,
        },
      }),
    ).toBe(1);
    expect(await prisma.idea.findUnique({ where: { id: a.id } })).toMatchObject(
      { convertedType: "idea", convertedId: b.id },
    );
    await expect(
      mutateIdea(outsider, { op: "merge", ideaId: b.id, targetId: a.id }),
    ).rejects.toThrow();
  });
  it("applies document, project and task templates through their owning services", async () => {
    for (const kind of ["DOC", "PROJECT", "TASK"] as const) {
      const t = await mutateTemplate(owner, {
        op: "create",
        kind,
        name: `${kind} starter`,
        title: "Community repair",
        text: "Build with {{workspace}}",
      });
      const applied = await mutateTemplate(owner, {
        op: "apply",
        templateId: t.id,
        key: "REPAIR",
        projectId,
        requestId: kind,
      });
      const again = await mutateTemplate(owner, {
        op: "apply",
        templateId: t.id,
        key: "REPAIR",
        projectId,
        requestId: kind,
      });
      expect(again.id).toBe(applied.id);
      await expect(
        mutateTemplate(outsider, {
          op: "apply",
          templateId: t.id,
          requestId: "foreign",
        }),
      ).rejects.toThrow();
    }
  });
  it("requests and signs an immutable document acknowledgement, storing only an IP hash", async () => {
    const r = await mutateSignature(owner, {
      op: "request",
      docId,
      signerUserId: member.user.id,
    });
    expect(await signatureView(outsider, r.id)).toBeNull();
    await expect(
      mutateSignature(owner, {
        op: "sign",
        requestId: r.id,
        typedName: "Wrong signer",
        acknowledge: true,
      }),
    ).rejects.toThrow();
    await mutateSignature(
      member,
      {
        op: "sign",
        requestId: r.id,
        typedName: "Maker Member",
        acknowledge: true,
      },
      "203.0.113.42",
    );
    const signed = await prisma.signatureRequest.findUniqueOrThrow({
      where: { id: r.id },
    });
    expect(signed.status).toBe("SIGNED");
    expect(signed.typedName).toBe("Maker Member");
    expect(signed.signedAt).toBeInstanceOf(Date);
    expect(signed.ip).toMatch(/^[a-f0-9]{64}$/);
    expect(signed.ip).not.toContain("203.0.113.42");
    await expect(
      mutateSignature(member, {
        op: "sign",
        requestId: r.id,
        typedName: "Again",
        acknowledge: true,
      }),
    ).rejects.toThrow();
  });
  it("prevents acknowledging a changed version and enforces admin-only document access", async () => {
    const r = await mutateSignature(owner, {
      op: "request",
      docId,
      signerUserId: guest.user.id,
    });
    await prisma.doc.update({
      where: { id: docId },
      data: { contentHtml: "<p>Updated agreement</p>" },
    });
    expect((await signatureView(guest, r.id))?.currentMatches).toBe(false);
    await expect(
      mutateSignature(guest, {
        op: "sign",
        requestId: r.id,
        typedName: "Guest Member",
        acknowledge: true,
      }),
    ).rejects.toThrow();
    const secret = await prisma.doc.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Admin document",
        visibility: "ADMINS",
        createdById: owner.user.id,
      },
    });
    await expect(
      mutateSignature(owner, {
        op: "request",
        docId: secret.id,
        signerUserId: member.user.id,
      }),
    ).rejects.toThrow();
    expect(
      contentHash("Workshop agreement", "<p>Updated agreement</p>"),
    ).not.toBe(
      (await prisma.signatureRequest.findUniqueOrThrow({ where: { id: r.id } }))
        .contentHash,
    );
  });
  it("publishes internal changelog entries", async () => {
    const e = await mutateChangelog(owner, {
      op: "create",
      title: "Repair station ready",
      bodyMd: "The crew can repair small appliances.",
      audience: "PUBLIC",
      version: "1.0",
      tags: ["workshop"],
    });
    await mutateChangelog(owner, {
      op: "publish",
      entryId: e.id,
      publishedAt: new Date(),
    });
    expect((await prisma.changelogEntry.findUniqueOrThrow({ where: { id: e.id } })).publishedAt).not.toBeNull();
    await expect(
      mutateChangelog(member, {
        op: "create",
        title: "Not authorised",
        bodyMd: "Test",
      }),
    ).rejects.toThrow();
  });
  it("rejects suspended membership even when a stale actor object is supplied", async () => {
    await prisma.membership.update({
      where: {
        userId_workspaceId: {
          workspaceId: owner.workspace.id,
          userId: member.user.id,
        },
      },
      data: { status: "SUSPENDED" },
    });
    await expect(
      mutateIdea(member, { op: "create", title: "Stale membership" }),
    ).rejects.toThrow();
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
  it("allows authorised edits while keeping completed history and source ownership intact", async () => {
    await mutateCycle(owner, {
      op: "edit",
      cycleId: nextCycleId,
      name: "Next build cycle",
      goal: "Keep the repair work moving",
      startsAt,
      endsAt,
    });
    await expect(
      mutateCycle(owner, {
        op: "edit",
        cycleId,
        name: "Rewrite history",
        startsAt,
        endsAt,
      }),
    ).rejects.toThrow();
    await mutateCycle(owner, {
      op: "review",
      cycleId,
      review: "The carry-over is ready for the next build.",
    });
    await mutateGoal(member, {
      op: "edit",
      goalId,
      title: "Make repair easier together",
      ownerId: member.user.id,
      periodStart: new Date("2026-10-01"),
      periodEnd: new Date("2026-12-31"),
    });
    const idea = await mutateIdea(member, {
      op: "create",
      title: "Maker guide",
    });
    await mutateIdea(member, {
      op: "edit",
      ideaId: idea.id,
      title: "First-time maker guide",
      bodyMd: "Start with safety and shared tools.",
    });
    await expect(
      mutateIdea(outsider, {
        op: "edit",
        ideaId: idea.id,
        title: "Foreign edit",
      }),
    ).rejects.toThrow();
    const template = await mutateTemplate(member, {
      op: "create",
      kind: "DOC",
      name: "Guide",
      title: "A maker guide",
      text: "Start here",
    });
    await mutateTemplate(member, {
      op: "edit",
      templateId: template.id,
      name: "Maker guide",
      title: "Welcome {{author}}",
      text: "Start with the shared tools.",
    });
    await expect(
      mutateTemplate(guest, {
        op: "edit",
        templateId: template.id,
        name: "Guest edit",
        title: "Guest edit",
      }),
    ).rejects.toThrow();
    expect(
      await prisma.template.findUnique({ where: { id: template.id } }),
    ).toMatchObject({
      createdById: member.user.id,
      kind: "DOC",
      name: "Maker guide",
    });
  });
  it("runs periodic work idempotently across replicas", async () => {
    const clock = new Date(startsAt.getTime() - 3_600_000);
    await run(clock);
    await run(clock);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "meeting.agenda_reminder",
          payload: { path: ["data", "meetingId"], equals: meetingId },
        },
      }),
    ).toBe(1);
  });
});
