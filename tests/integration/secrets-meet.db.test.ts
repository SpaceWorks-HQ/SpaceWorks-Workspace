import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/google/tokens", () => ({ getGoogleAccessToken: vi.fn(async () => ({ ok: true, token: "fixture-only" })) }));
vi.mock("@/lib/integrations/http", () => ({ requestJson: provider }));
import { prisma } from "@/lib/db";
import { syncGoogle, finishMeetLink } from "@/lib/calendar/google";
import { createUser, createWorkspace, addMember, cleanup, uniqueSuffix } from "@/tests/helpers/fixtures";
import type { Actor } from "@/lib/meetings/core";
const suffix = uniqueSuffix(), domain = `${suffix}@meet.test`, slug = `meet-${suffix}`;
let owner: Actor, member: Actor;
const url = "https://meet.google.com/fixture";
const success = (data: unknown) => ({ ok: true as const, status: 200, headers: new Headers(), data });
async function meeting(actor: Actor) {
  const row = await prisma.meeting.create({ data: { workspaceId: actor.workspace.id, title: "Office planning", createdById: actor.user.id, startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 90000000), visibility: "WORKSPACE", attendees: { create: { userId: actor.user.id } } } });
  return row;
}
async function pending(actor: Actor) {
  const row = await meeting(actor);
  const connection = await prisma.integrationConnection.findFirstOrThrow({ where: { workspaceId: actor.workspace.id, connectedById: actor.user.id } });
  await prisma.meeting.update({ where: { id: row.id }, data: { meetPending: true } });
  return prisma.calendarMeetingSync.create({ data: { workspaceId: actor.workspace.id, meetingId: row.id, userId: actor.user.id, connectionId: connection.id, externalId: "fixture-event", sequence: row.sequence, meetPending: true, meetRequestedAt: new Date() } });
}
beforeAll(async () => {
  const o = await createUser("owner-" + domain), m = await createUser("member-" + domain), workspace = await createWorkspace(slug, o.id); await addMember(workspace.id, m.id);
  owner = { user: o, workspace, membership: { role: "OWNER" } }; member = { user: m, workspace, membership: { role: "MEMBER" } };
  for (const actor of [owner, member]) await prisma.integrationConnection.create({ data: { workspaceId: workspace.id, provider: "GOOGLE", connectedById: actor.user.id, externalId: actor.user.id, accountLabel: "Fixture calendar" } });
});
afterEach(() => provider.mockReset());
afterAll(async () => { await cleanup([slug], domain); await prisma.$disconnect(); });
describe("Meet creation persistence with mocked Google", () => {
  it("polls after a conference request, persists the link and includes it in invitation email", async () => {
    const row = await meeting(owner); let reads = 0;
    provider.mockImplementation(async (_url: string, options: { method?: string } = {}) => {
      if (options.method === "POST" || options.method === "PATCH") return success({ id: "fixture-event", etag: "v1", conferenceData: { createRequest: { status: { statusCode: "pending" } } } });
      reads++;
      if (reads === 1) return { ok: false, status: 404, retryable: false, error: "Missing fixture event" };
      return success(reads === 2 ? { conferenceData: { createRequest: { status: { statusCode: "pending" } } } } : { hangoutLink: url, etag: "v2" });
    });
    await syncGoogle(owner, row.id);
    const saved = await prisma.meeting.findUniqueOrThrow({ where: { id: row.id } }); expect(saved.videoUrl).toBe(url); expect(saved.meetPending).toBe(false);
    const binding = await prisma.calendarMeetingSync.findFirstOrThrow({ where: { workspaceId: owner.workspace.id, meetingId: row.id } }); expect(binding.meetPending).toBe(false);
    const emails = await prisma.outboxMessage.findMany({ where: { kind: "email", payload: { path: ["workspaceId"], equals: owner.workspace.id } } }); expect(JSON.stringify(emails)).toContain(url); expect(JSON.stringify(emails)).toContain("Join Google Meet");
  });
  it("finishes deferred conferences idempotently in the one-off worker path", async () => {
    const binding = await pending(owner); provider.mockResolvedValue(success({ hangoutLink: url, etag: "ready" }));
    await finishMeetLink(binding.id); await finishMeetLink(binding.id);
    const saved = await prisma.meeting.findUniqueOrThrow({ where: { id: binding.meetingId } }); expect(saved.videoUrl).toBe(url); expect(saved.sequence).toBe(1);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("imports remote title and time edits after a pending Meet follow-up", async () => {
    const binding = await pending(owner);
    await prisma.calendarMeetingSync.update({ where: { id: binding.id }, data: { etag: "before-conference" } });
    const startsAt = new Date(Date.now() + 2 * 86400000), endsAt = new Date(+startsAt + 3600000);
    const event = { hangoutLink: url, etag: "remote-edits", summary: "Edited on Google", start: { dateTime: startsAt.toISOString() }, end: { dateTime: endsAt.toISOString() } };
    provider.mockImplementation(async (_url: string, options: { method?: string } = {}) => {
      // Normal sync must import the remote edits rather than overwrite them.
      expect(options.method).toBeUndefined();
      return success(event);
    });
    await finishMeetLink(binding.id);
    const saved = await prisma.meeting.findUniqueOrThrow({ where: { id: binding.meetingId } });
    expect(saved.videoUrl).toBe(url);
    expect(saved.title).toBe("Office planning");
    const pendingSync = await prisma.calendarMeetingSync.findUniqueOrThrow({ where: { id: binding.id } });
    expect(pendingSync.etag).toBe("before-conference");
    expect(pendingSync.sequence).toBe(saved.sequence);
    await syncGoogle(owner);
    const imported = await prisma.meeting.findUniqueOrThrow({ where: { id: binding.meetingId } });
    expect(imported.title).toBe(event.summary);
    expect(imported.startsAt).toEqual(startsAt);
    expect(imported.endsAt).toEqual(endsAt);
    expect((await prisma.calendarMeetingSync.findUniqueOrThrow({ where: { id: binding.id } })).etag).toBe(event.etag);
  });
  it("preserves local edits and manual links while a conference request is pending", async () => {
    provider.mockResolvedValue(success({ hangoutLink: url, etag: "ready" }));
    const edited = await pending(owner);
    await prisma.meeting.update({ where: { id: edited.meetingId }, data: { title: "Updated locally", sequence: { increment: 1 } } });
    await finishMeetLink(edited.id);
    const updated = await prisma.meeting.findUniqueOrThrow({ where: { id: edited.meetingId } });
    expect(updated.title).toBe("Updated locally"); expect(updated.videoUrl).toBe(url); expect(updated.meetPending).toBe(false);
    // The remote title is still stale; the next sync must push local edits.
    expect((await prisma.calendarMeetingSync.findUniqueOrThrow({ where: { id: edited.id } })).sequence).toBeLessThan(updated.sequence);
    const manual = await pending(owner), custom = "https://video.example.org/office";
    await prisma.meeting.update({ where: { id: manual.meetingId }, data: { videoUrl: custom, sequence: { increment: 1 } } });
    await finishMeetLink(manual.id);
    const saved = await prisma.meeting.findUniqueOrThrow({ where: { id: manual.meetingId } }); expect(saved.videoUrl).toBe(custom); expect(saved.meetPending).toBe(false);
    expect((await prisma.calendarMeetingSync.findUniqueOrThrow({ where: { id: manual.id } })).meetPending).toBe(false);
  });
  it("rechecks live membership before deferred provider calls", async () => {
    const binding = await pending(member);
    await prisma.membership.update({ where: { userId_workspaceId: { userId: member.user.id, workspaceId: member.workspace.id } }, data: { status: "SUSPENDED" } });
    await finishMeetLink(binding.id); expect(provider).not.toHaveBeenCalled();
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: binding.meetingId } })).videoUrl).toBeNull();
    expect((await prisma.calendarMeetingSync.findUniqueOrThrow({ where: { id: binding.id } })).meetPending).toBe(false);
    await prisma.membership.update({ where: { userId_workspaceId: { userId: member.user.id, workspaceId: member.workspace.id } }, data: { status: "ACTIVE", role: "MEMBER" } });
    const downgraded = await pending(member);
    await prisma.membership.update({ where: { userId_workspaceId: { userId: member.user.id, workspaceId: member.workspace.id } }, data: { role: "GUEST" } });
    await finishMeetLink(downgraded.id); expect(provider).not.toHaveBeenCalled();
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: downgraded.meetingId } })).videoUrl).toBeNull();
    expect((await prisma.calendarMeetingSync.findUniqueOrThrow({ where: { id: downgraded.id } })).meetPending).toBe(false);
  });
});
