import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { CommunityActor } from "@/lib/community/context";
import { buildFeed, createFeed, listFeeds, resolveFeedToken, revokeFeed } from "@/lib/community/feeds";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@community-ics-${suffix}.test`;
const slugA = `cics-a-${suffix}`;
const slugB = `cics-b-${suffix}`;
const DAY = 24 * 60 * 60 * 1000;

type Ws = { id: string; slug: string; name: string; timezone: string };
let wsA: Ws;
let wsB: Ws;
let member: CommunityActor;
let memberInB: CommunityActor;
let ownerB: CommunityActor;

const tokenOf = (url: string) => url.split("/ics/")[1]!.replace(/\.ics$/, "");
async function feedFor(actor: CommunityActor, scope: "PERSONAL" | "CALENDAR") {
  const created = await createFeed(actor, { scope });
  if (!created.ok) throw new Error(created.error);
  return { ...created.data!, token: tokenOf(created.data!.url) };
}
async function read(token: string) {
  const feed = await resolveFeedToken(token);
  return feed ? buildFeed(feed) : null;
}

describe.sequential("calendar feeds", () => {
  beforeAll(async () => {
    const ownerA = await createUser(`ownera${domain}`, "Owner A");
    const meera = await createUser(`meera${domain}`, "Meera");
    const bOwner = await createUser(`ownerb${domain}`, "Owner B");
    const a = await createWorkspace(slugA, ownerA.id);
    const b = await createWorkspace(slugB, bOwner.id);
    wsA = { id: a.id, slug: a.slug, name: a.name, timezone: a.timezone };
    wsB = { id: b.id, slug: b.slug, name: b.name, timezone: b.timezone };
    await addMember(wsA.id, meera.id, "MEMBER");
    await addMember(wsB.id, meera.id, "MEMBER");
    member = { user: { id: meera.id, name: "Meera" }, workspace: wsA, membership: { role: "MEMBER" } };
    memberInB = { user: { id: meera.id, name: "Meera" }, workspace: wsB, membership: { role: "MEMBER" } };
    ownerB = { user: { id: bOwner.id, name: "Owner B" }, workspace: wsB, membership: { role: "OWNER" } };

    const soon = (days: number) => new Date(Date.now() + days * DAY);
    const goingA = await prisma.communityEvent.create({ data: { workspaceId: wsA.id, title: "A build night", kind: "BUILD_NIGHT", startsAt: soon(3), location: "Kochi, workshop" } });
    await prisma.communityEvent.create({ data: { workspaceId: wsA.id, title: "A meetup nobody replied to", kind: "MEETUP", startsAt: soon(4) } });
    await prisma.communityEvent.create({ data: { workspaceId: wsA.id, title: "A cancelled workshop", kind: "WORKSHOP", startsAt: soon(5), cancelledAt: new Date() } });
    const eventB = await prisma.communityEvent.create({ data: { workspaceId: wsB.id, title: "B secret summit", startsAt: soon(3) } });
    await prisma.eventAttendee.create({ data: { eventId: goingA.id, userId: meera.id, status: "GOING" } });
    await prisma.eventAttendee.create({ data: { eventId: eventB.id, userId: meera.id, status: "GOING" } });

    // Personal items: a meeting, a shift and a task due date in A; a task in B.
    const meeting = await prisma.meeting.create({ data: { workspaceId: wsA.id, title: "A committee meeting", startsAt: soon(6), visibility: "WORKSPACE" } });
    await prisma.meetingAttendee.create({ data: { meetingId: meeting.id, userId: meera.id, rsvp: "YES" } });
    const shiftType = await prisma.shiftType.create({ data: { workspaceId: wsA.id, name: "Keyholder" } });
    const shift = await prisma.shift.create({ data: { workspaceId: wsA.id, shiftTypeId: shiftType.id, startsAt: soon(2), endsAt: new Date(soon(2).getTime() + 3 * 60 * 60 * 1000), capacity: 1 } });
    await prisma.shiftAssignment.create({ data: { shiftId: shift.id, userId: meera.id } });
    await prisma.task.create({ data: { workspaceId: wsA.id, number: 1, title: "A sensor bar PCB", dueAt: soon(7), assignees: { create: { userId: meera.id } } } });
    await prisma.task.create({ data: { workspaceId: wsB.id, number: 1, title: "B private task", dueAt: soon(7), assignees: { create: { userId: meera.id } } } });
  });

  afterAll(async () => {
    await cleanup([slugA, slugB], domain);
    await prisma.$disconnect();
  });

  it("stores only a hash of the token and shows the URL once", async () => {
    const feed = await feedFor(member, "CALENDAR");
    expect(feed.url).toMatch(/^http:\/\/localhost:3100\/ics\/[A-Za-z0-9_-]{43}\.ics$/);
    expect(feed.webcalUrl.startsWith("webcal://localhost:3100/ics/")).toBe(true);
    const rows = await prisma.calendarFeedToken.findMany({ where: { workspaceId: wsA.id, userId: member.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(feed.token);
    expect((await listFeeds(member)).has("CALENDAR")).toBe(true);
    const audit = await prisma.auditEvent.findFirst({ where: { workspaceId: wsA.id, action: "calendar_feed.created" } });
    expect(JSON.stringify(audit?.metadata)).not.toContain(feed.token);
  });

  it("serves the community calendar of its own workspace only", async () => {
    const feed = await feedFor(member, "CALENDAR");
    const body = (await read(feed.token))!;
    expect(body).toContain("SUMMARY:A build night");
    expect(body).toContain("SUMMARY:A meetup nobody replied to");
    expect(body).toContain("SUMMARY:Cancelled: A cancelled workshop");
    expect(body).toContain("STATUS:CANCELLED");
    expect(body).toContain("LOCATION:Kochi\\, workshop");
    expect(body).not.toContain("B secret summit");
    expect(body).not.toContain("committee meeting");
  });

  it("serves the personal feed: replies, meetings, shifts and task due dates, scoped to one workspace", async () => {
    const feed = await feedFor(member, "PERSONAL");
    const body = (await read(feed.token))!;
    expect(body).toContain("SUMMARY:A build night");
    expect(body).not.toContain("A meetup nobody replied to");
    expect(body).toContain("SUMMARY:A committee meeting");
    expect(body).toContain("SUMMARY:Keyholder shift");
    expect(body).toMatch(/SUMMARY:Due: #1 A sensor bar PCB/);
    expect(body).toMatch(/DTSTART;VALUE=DATE:\d{8}/);
    expect(body).not.toContain("B secret summit");
    expect(body).not.toContain("B private task");

    // The same member's feed for workspace B never shows A.
    const other = await feedFor(memberInB, "PERSONAL");
    const bodyB = (await read(other.token))!;
    expect(bodyB).toContain("B secret summit");
    expect(bodyB).toContain("B private task");
    expect(bodyB).not.toContain("A build night");
  });

  it("breaks the old URL when regenerated or revoked", async () => {
    const first = await feedFor(member, "PERSONAL");
    const second = await feedFor(member, "PERSONAL");
    expect(await resolveFeedToken(first.token)).toBeNull();
    expect(await resolveFeedToken(second.token)).not.toBeNull();
    expect((await revokeFeed(member, { scope: "PERSONAL" })).ok).toBe(true);
    expect(await resolveFeedToken(second.token)).toBeNull();
    expect((await listFeeds(member)).has("PERSONAL")).toBe(false);
  });

  it("stops working when the member is suspended and rejects malformed tokens", async () => {
    const feed = await feedFor(member, "CALENDAR");
    await prisma.membership.update({ where: { userId_workspaceId: { userId: member.user.id, workspaceId: wsA.id } }, data: { status: "SUSPENDED" } });
    expect(await resolveFeedToken(feed.token)).toBeNull();
    await prisma.membership.update({ where: { userId_workspaceId: { userId: member.user.id, workspaceId: wsA.id } }, data: { status: "ACTIVE" } });
    expect(await resolveFeedToken(feed.token)).not.toBeNull();
    expect(await resolveFeedToken("short")).toBeNull();
    expect(await resolveFeedToken("../../etc/passwd-aaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
  });

  it("keeps one member's tokens away from other members' revocation", async () => {
    const feed = await feedFor(memberInB, "CALENDAR");
    // Owner B revoking their own (non-existent) feed leaves Meera's feed alone.
    expect((await revokeFeed(ownerB, { scope: "CALENDAR" })).ok).toBe(true);
    expect(await resolveFeedToken(feed.token)).not.toBeNull();
  });
});
