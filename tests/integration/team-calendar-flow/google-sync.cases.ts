import { expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { syncGoogle, googleBusy } from "@/lib/calendar/google";
import { findGoogleConnection } from "@/lib/integrations/google/tokens";
import { encryptIntegrationToken } from "@/lib/integrationSecrets";
import {
  suffix,
  domain,
  owner,
  member,
  start,
  end,
} from "./fixtures";

export function registerGoogleSyncTests() {
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
}
