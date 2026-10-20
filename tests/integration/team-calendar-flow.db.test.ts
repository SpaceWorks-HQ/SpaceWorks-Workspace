import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveMeeting,
  cancelMeeting,
  moveTaskDue,
  saveEntry,
} from "@/lib/calendar/service";
import { mutateMeeting } from "@/lib/meetings/service";
import { loadCalendar } from "@/lib/calendar/query";
import { availabilityFor } from "@/lib/calendar/availability";
import { syncGoogle, googleBusy } from "@/lib/calendar/google";
import { run } from "@/lib/scheduled/calendar";
import { findGoogleConnection } from "@/lib/integrations/google/tokens";
import { encryptIntegrationToken } from "@/lib/integrationSecrets";
import { searchDocuments } from "@/lib/search/query";
import { createFeed, resolveFeedToken, buildFeed } from "@/lib/community/feeds";
import { attachCalendarFile } from "@/lib/calendar/files";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import { deleteObjects } from "@/lib/storage";
import type { Actor } from "@/lib/meetings/core";
import {
  createUser,
  createWorkspace,
  addMember,
  cleanup,
  uniqueSuffix,
} from "../helpers/fixtures";
const suffix = uniqueSuffix(),
  domain = `@calendar-${suffix}.test`,
  slugs = [`calendar-a-${suffix}`, `calendar-b-${suffix}`];
let owner: Actor,
  member: Actor,
  guest: Actor,
  other: Actor,
  meetingId: string,
  projectId: string,
  taskId: string,
  secretTaskId: string,
  teamId: string,
  entryId: string;
const start = new Date(Date.now() + 3 * 86400000),
  end = new Date(start.getTime() + 86400000);
const command = (extra: Record<string, unknown> = {}) => ({
  title: "Community office planning",
  startsAt: start,
  duration: 60,
  timezone: "Asia/Kolkata",
  until: start,
  ...extra,
});
async function calendar(actor: Actor) {
  return loadCalendar(
    actor,
    new Date(Date.now() - 86400000),
    new Date(Date.now() + 14 * 86400000),
  );
}
async function makeActor(userId: string, workspaceId: string): Promise<Actor> {
  const [user, workspace, membership] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    prisma.membership.findUniqueOrThrow({
      where: { userId_workspaceId: { userId, workspaceId } },
    }),
  ]);
  return { user, workspace, membership };
}
describe.sequential("internal team calendar", () => {
  beforeAll(async () => {
    const [a, b, c, d] = await Promise.all([
      createUser(`owner${domain}`),
      createUser(`member${domain}`),
      createUser(`guest${domain}`),
      createUser(`other${domain}`),
    ]);
    const ws = await createWorkspace(slugs[0], a.id),
      foreign = await createWorkspace(slugs[1], d.id);
    await addMember(ws.id, b.id);
    await addMember(ws.id, c.id, "GUEST");
    [owner, member, guest, other] = await Promise.all([
      makeActor(a.id, ws.id),
      makeActor(b.id, ws.id),
      makeActor(c.id, ws.id),
      makeActor(d.id, foreign.id),
    ]);
    const team = await prisma.team.create({
      data: {
        workspaceId: ws.id,
        name: "Finance team",
        slug: "finance",
        visibility: "PRIVATE",
        members: { create: { userId: a.id } },
      },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        workspaceId: ws.id,
        name: "Office work",
        key: "OFFICE",
        ownerId: a.id,
      },
    });
    projectId = project.id;
    const secret = await prisma.project.create({
      data: {
        workspaceId: ws.id,
        name: "Private finance",
        key: "FIN",
        teamId: team.id,
        ownerId: a.id,
      },
    });
    taskId = (
      await prisma.task.create({
        data: {
          workspaceId: ws.id,
          number: 990,
          title: "Prepare volunteer schedule",
          projectId: project.id,
          dueAt: start,
          creatorId: a.id,
          assignees: { create: { userId: b.id } },
        },
      })
    ).id;
    secretTaskId = (
      await prisma.task.create({
        data: {
          workspaceId: ws.id,
          number: 991,
          title: "Private team due date",
          projectId: secret.id,
          dueAt: start,
          creatorId: a.id,
          assignees: { create: { userId: b.id } },
        },
      })
    ).id;
  });
  afterAll(async () => {
    vi.unstubAllGlobals();
    const files = await prisma.fileObject.findMany({
      where: { workspaceId: owner.workspace.id, folder: "/calendar" },
      select: { storageKey: true },
    });
    await deleteObjects(files.map((f) => f.storageKey));
    await cleanup(slugs, domain);
  });
  it("creates a meeting, attendee rows, notification event and RFC outbox invitations atomically", async () => {
    meetingId = (
      await saveMeeting(
        owner,
        command({
          attendeeIds: [member.user.id, guest.user.id],
          externalEmails: ["partner@example.test"],
          projectId,
        }),
      )
    ).id;
    expect(await prisma.meetingAttendee.count({ where: { meetingId } })).toBe(
      3,
    );
    const event = await prisma.notificationEventRecord.findFirst({
      where: {
        workspaceId: owner.workspace.id,
        type: "meeting.scheduled",
        payload: { path: ["resource", "id"], equals: meetingId },
      },
    });
    expect(event).toBeTruthy();
    const emails = await prisma.outboxMessage.findMany({
      where: {
        kind: "email",
        payload: { path: ["workspaceId"], equals: owner.workspace.id },
      },
    });
    expect(
      emails.some((e) => JSON.stringify(e.payload).includes("METHOD:REQUEST")),
    ).toBe(true);
    expect(
      emails.some(
        (e) => (e.payload as { to: string }).to === "partner@example.test",
      ),
    ).toBe(true);
  });
  it("updates an occurrence with the same UID and increased sequence", async () => {
    await saveMeeting(
      owner,
      command({
        id: meetingId,
        title: "Updated office planning",
        attendeeIds: [member.user.id, guest.user.id],
        externalEmails: ["partner@example.test"],
        projectId,
      }),
    );
    const m = await prisma.meeting.findFirstOrThrow({
      where: { id: meetingId, workspaceId: owner.workspace.id },
    });
    expect(m.sequence).toBe(1);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "meeting.updated",
          payload: { path: ["resource", "id"], equals: meetingId },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxMessage.count({
        where: {
          kind: "email",
          payload: {
            path: ["calendarInvite", "content"],
            string_contains: `UID:meeting-${meetingId}@spaceworks-workspace\r\nSEQUENCE:1`,
          },
        },
      }),
    ).toBeGreaterThan(0);
  });
  it("saves internal and guest RSVP and rejects nonattendees", async () => {
    await mutateMeeting(member, { op: "rsvp", meetingId, rsvp: "MAYBE" });
    await mutateMeeting(guest, { op: "rsvp", meetingId, rsvp: "YES" });
    expect(
      (
        await prisma.meetingAttendee.findUniqueOrThrow({
          where: { meetingId_userId: { meetingId, userId: member.user.id } },
        })
      ).rsvp,
    ).toBe("MAYBE");
    const noInvite = await saveMeeting(owner, command());
    await expect(
      mutateMeeting(guest, { op: "rsvp", meetingId: noInvite.id, rsvp: "YES" }),
    ).rejects.toThrow();
  });
  it("only permits organisers and admins to edit or cancel meetings", async () => {
    await expect(
      saveMeeting(member, command({ id: meetingId })),
    ).rejects.toThrow();
    await expect(cancelMeeting(member, meetingId)).rejects.toThrow();
    await expect(saveMeeting(guest, command())).rejects.toThrow();
  });
  it("loads long maintenance windows and hides private-team task dates", async () => {
    const maintenance = await prisma.maintenanceWindow.create({
      data: {
        workspaceId: owner.workspace.id,
        title: "Three-day office network work",
        startsAt: new Date(Date.now() - 2 * 86400000),
        endsAt: new Date(Date.now() + 86400000),
      },
    });
    const items = (await calendar(member)).items;
    expect(
      items.some((i) => i.id.startsWith(`maintenance:${maintenance.id}`)),
    ).toBe(true);
    expect(items.some((i) => i.sourceId === taskId)).toBe(true);
    expect(items.some((i) => i.sourceId === secretTaskId)).toBe(false);
  });
  it("limits guests to meetings and tasks they are part of", async () => {
    const items = (await calendar(guest)).items;
    expect(items.some((i) => i.sourceId === meetingId)).toBe(true);
    expect(items.some((i) => i.sourceId === taskId)).toBe(false);
    expect(
      items.every((i) => ["meeting", "task", "reminder"].includes(i.layer)),
    ).toBe(true);
  });
  it("changes task due dates through the task service with role and team checks", async () => {
    await moveTaskDue(member, { taskId, dueDate: "2026-12-10" });
    expect(
      (
        await prisma.task.findFirstOrThrow({
          where: { id: taskId, workspaceId: owner.workspace.id },
        })
      ).dueAt?.toISOString(),
    ).toBe("2026-12-09T18:30:00.000Z");
    await expect(
      moveTaskDue(guest, { taskId, dueDate: "2026-12-11" }),
    ).rejects.toThrow();
    await expect(
      moveTaskDue(member, { taskId: secretTaskId, dueDate: "2026-12-11" }),
    ).rejects.toThrow();
    await expect(
      moveTaskDue(other, { taskId, dueDate: "2026-12-11" }),
    ).rejects.toThrow();
  });
  it("rejects foreign attendees, projects and teams and cross-workspace changes", async () => {
    await expect(
      saveMeeting(owner, command({ attendeeIds: [other.user.id] })),
    ).rejects.toThrow();
    await expect(saveMeeting(other, command({ projectId }))).rejects.toThrow();
    await expect(saveMeeting(other, command({ teamId }))).rejects.toThrow();
    await expect(cancelMeeting(other, meetingId)).rejects.toThrow();
    expect(
      (await calendar(other)).items.some((i) => i.sourceId === meetingId),
    ).toBe(false);
  });
  it("materialises a finite recurring series in the selected time zone", async () => {
    const series = await saveMeeting(
      owner,
      command({ repeat: "DAILY", until: end }),
    );
    expect(
      await prisma.meeting.count({
        where: { workspaceId: owner.workspace.id, seriesId: series.id },
      }),
    ).toBe(2);
  });
  it("merges availability from meetings, absences and rota without leaking titles or notes", async () => {
    await prisma.availability.create({
      data: {
        workspaceId: owner.workspace.id,
        userId: member.user.id,
        type: "AWAY",
        startsAt: start,
        endsAt: end,
        visibility: "PRIVATE",
        note: "Private reason",
      },
    });
    const result = await availabilityFor(owner, {
      attendeeIds: [member.user.id],
      duration: 60,
      timezone: "Asia/Kolkata",
    });
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain("Private reason");
    expect(JSON.stringify(result)).not.toContain("office planning");
    await expect(
      availabilityFor(owner, {
        attendeeIds: [other.user.id],
        duration: 60,
        timezone: "UTC",
      }),
    ).rejects.toThrow();
  });
  it("keeps personal reminders owner-only in the calendar and live search", async () => {
    entryId = (
      await saveEntry(member, {
        title: `PrivateReminder${suffix}`,
        kind: "REMINDER",
        startsAt: start,
        until: start,
        timezone: "Asia/Kolkata",
      })
    ).id;
    expect(
      (await calendar(member)).items.some((i) => i.sourceId === entryId),
    ).toBe(true);
    expect(
      (await calendar(owner)).items.some((i) => i.sourceId === entryId),
    ).toBe(false);
    expect(
      await searchDocuments(
        {
          workspaceId: owner.workspace.id,
          userId: owner.user.id,
          role: "OWNER",
        },
        `PrivateReminder${suffix}`,
      ),
    ).toEqual([]);
    expect(
      (
        await searchDocuments(
          {
            workspaceId: member.workspace.id,
            userId: member.user.id,
            role: "MEMBER",
          },
          `PrivateReminder${suffix}`,
        )
      ).some((h) => h.entityId === entryId),
    ).toBe(true);
  });
  it("limits compliance entry creation to admins and rejects shared personal reminders", async () => {
    await expect(
      saveEntry(member, {
        title: "GST deadline",
        kind: "DEADLINE",
        startsAt: start,
        until: start,
        timezone: "Asia/Kolkata",
      }),
    ).rejects.toThrow();
    await expect(
      saveEntry(member, {
        title: "Reminder",
        kind: "REMINDER",
        visibility: "WORKSPACE",
        startsAt: start,
        until: start,
        timezone: "Asia/Kolkata",
      }),
    ).rejects.toThrow();
    const e = await saveEntry(owner, {
      title: "TDS filing",
      kind: "DEADLINE",
      visibility: "WORKSPACE",
      startsAt: start,
      until: start,
      timezone: "Asia/Kolkata",
    });
    expect(
      (await calendar(member)).items.some((i) => i.sourceId === e.id),
    ).toBe(true);
    expect((await calendar(guest)).items.some((i) => i.sourceId === e.id)).toBe(
      false,
    );
  });
  it("authorises proof downloads by the parent record and excludes them from the library", async () => {
    const file = await attachCalendarFile(
      member,
      entryId,
      new File(["%PDF-1.4\n%%EOF"], "acknowledgement.pdf", {
        type: "application/pdf",
      }),
    );
    expect(await findDownloadableFile(file.id, member.user.id)).toBeTruthy();
    expect(await findDownloadableFile(file.id, owner.user.id)).toBeNull();
    expect(await findDownloadableFile(file.id, other.user.id)).toBeNull();
    expect(
      await prisma.fileObject.findFirst({
        where: { AND: [await libraryWhere(member), { id: file.id }] },
      }),
    ).toBeNull();
    await expect(
      attachCalendarFile(
        other,
        entryId,
        new File(["x"], "proof.pdf", { type: "application/pdf" }),
      ),
    ).rejects.toThrow();
  });
  it("includes visible renewal dates and reminders in the personal feed", async () => {
    await prisma.subscription.create({
      data: {
        workspaceId: owner.workspace.id,
        name: "Office internet renewal",
        kind: "OTHER",
        period: "MONTHLY",
        ownerId: member.user.id,
        nextRenewalAt: start,
      },
    });
    const feed = await createFeed(member, { scope: "PERSONAL" });
    expect(feed.ok).toBe(true);
    if (!feed.ok) return;
    const raw = feed
      .data!.url.split("/")
      .at(-1)!
      .replace(/\.ics$/, "");
    const resolved = await resolveFeedToken(raw);
    expect(resolved).toBeTruthy();
    const body = await buildFeed(resolved!);
    expect(body).toContain("Office internet renewal");
    expect(body).toContain(`PrivateReminder${suffix}`);
  });
  it("sends a meeting reminder once across repeated scheduler runs", async () => {
    const reminder = await saveMeeting(
      owner,
      command({
        startsAt: new Date(Date.now() + 10 * 60000),
        until: new Date(Date.now() + 10 * 60000 + 1000),
        attendeeIds: [member.user.id],
        reminderMinutes: 30,
      }),
    );
    await run(new Date());
    await run(new Date());
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "meeting.reminder",
          payload: { path: ["resource", "id"], equals: reminder.id },
        },
      }),
    ).toBe(1);
  });
  it("cancels with a stable UID, increased sequence, notification and CANCEL invitation", async () => {
    await cancelMeeting(owner, meetingId);
    await cancelMeeting(owner, meetingId);
    expect(
      (await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } }))
        .sequence,
    ).toBe(2);
    expect(
      await prisma.notificationEventRecord.count({
        where: {
          workspaceId: owner.workspace.id,
          type: "meeting.cancelled",
          payload: { path: ["resource", "id"], equals: meetingId },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.outboxMessage.count({
        where: {
          kind: "email",
          payload: {
            path: ["calendarInvite", "content"],
            string_contains: `UID:meeting-${meetingId}@spaceworks-workspace\r\nSEQUENCE:2`,
          },
        },
      }),
    ).toBeGreaterThan(0);
  });
  it("checks membership again after suspension", async () => {
    await prisma.membership.updateMany({
      where: { workspaceId: member.workspace.id, userId: member.user.id },
      data: { status: "SUSPENDED" },
    });
    await expect(calendar(member)).rejects.toThrow();
    await expect(saveMeeting(member, command())).rejects.toThrow();
    await prisma.membership.updateMany({
      where: { workspaceId: member.workspace.id, userId: member.user.id },
      data: { status: "ACTIVE" },
    });
  });
  it("uses only the member's own Google connection and mocks every provider call", async () => {
    await prisma.integrationConnection.create({
      data: {
        workspaceId: owner.workspace.id,
        provider: "GOOGLE",
        externalId: `google-${suffix}`,
        metadata: { personalCalendar: true },
        accountLabel: `owner${domain}`,
        connectedById: owner.user.id,
        accessTokenEnc: encryptIntegrationToken("fixture-google-access"),
        expiresAt: new Date(Date.now() + 3600000),
        scopes: ["https://www.googleapis.com/auth/calendar.events"],
      },
    });
    const mock = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith("/freeBusy"))
          return Response.json({
            calendars: {
              primary: {
                busy: [{ start: start.toISOString(), end: end.toISOString() }],
              },
            },
          });
        if (!init?.method || init.method === "GET")
          return Response.json({ error: { code: 404 } }, { status: 404 });
        return Response.json({ id: "provider-id", etag: "v1" });
      },
    );
    vi.stubGlobal("fetch", mock);
    expect(await findGoogleConnection(owner.workspace.id)).toBeNull();
    expect(
      await googleBusy(owner.workspace.id, member.user.id, start, end),
    ).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
    expect(
      await googleBusy(owner.workspace.id, owner.user.id, start, end),
    ).toHaveLength(1);
    expect((await syncGoogle(owner)).synced).toBeGreaterThan(0);
    expect(
      mock.mock.calls.every((c) =>
        String(c[0]).startsWith("https://www.googleapis.com/calendar/v3"),
      ),
    ).toBe(true);
    await expect(syncGoogle(member)).rejects.toThrow();
    vi.unstubAllGlobals();
  });
  it("imports organiser edits and attendee RSVP from their own Google copies", async () => {
    const records = new Map<string, Record<string, unknown>>();
    const provider = vi.fn(
      async (url: string | URL | Request, init?: RequestInit) => {
        const path = String(url).split("?")[0];
        if (!init?.method || init.method === "GET") {
          const record = records.get(path);
          return record
            ? Response.json(record)
            : Response.json({ error: { code: 404 } }, { status: 404 });
        }
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        const key = init.method === "POST" ? `${path}/${body.id}` : path;
        const record = { ...records.get(key), ...body, etag: "initial" };
        records.set(key, record);
        return Response.json(record);
      },
    );
    vi.stubGlobal("fetch", provider);
    await syncGoogle(owner);
    const active = await prisma.meeting.findFirstOrThrow({
      where: {
        workspaceId: owner.workspace.id,
        status: "SCHEDULED",
        attendees: { some: { userId: member.user.id } },
      },
    });
    const binding = await prisma.calendarMeetingSync.findFirstOrThrow({
      where: {
        workspaceId: owner.workspace.id,
        meetingId: active.id,
        userId: owner.user.id,
      },
    });
    const key = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${binding.externalId}`;
    const record = records.get(key)!;
    records.set(key, {
      ...record,
      etag: "organiser-edit",
      summary: "Provider planning update",
      start: { dateTime: start.toISOString() },
      end: { dateTime: new Date(start.getTime() + 3600000).toISOString() },
    });
    await syncGoogle(owner);
    expect(
      (await prisma.meeting.findUniqueOrThrow({ where: { id: active.id } }))
        .title,
    ).toBe("Provider planning update");
    await prisma.integrationConnection.create({
      data: {
        workspaceId: member.workspace.id,
        provider: "GOOGLE",
        externalId: `member-google-${suffix}`,
        connectedById: member.user.id,
        accountLabel: `member${domain}`,
        accessTokenEnc: encryptIntegrationToken("fixture-member-token"),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await syncGoogle(member);
    const memberBinding = await prisma.calendarMeetingSync.findFirstOrThrow({
      where: {
        workspaceId: member.workspace.id,
        meetingId: active.id,
        userId: member.user.id,
      },
    });
    const memberKey = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${memberBinding.externalId}`;
    records.set(memberKey, {
      ...records.get(memberKey),
      etag: "attendee-edit",
      summary: "Must not replace organiser title",
      attendees: [{ self: true, responseStatus: "accepted" }],
    });
    await syncGoogle(member);
    expect(
      (await prisma.meeting.findUniqueOrThrow({ where: { id: active.id } }))
        .title,
    ).toBe("Provider planning update");
    expect(
      (
        await prisma.meetingAttendee.findUniqueOrThrow({
          where: {
            meetingId_userId: { meetingId: active.id, userId: member.user.id },
          },
        })
      ).rsvp,
    ).toBe("YES");
    vi.unstubAllGlobals();
  });
});
