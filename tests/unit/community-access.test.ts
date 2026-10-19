import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import {
  canCreateEvents,
  canDeleteShoutout,
  canEditEvent,
  canGiveShoutouts,
  canManageAnnouncements,
  canRsvp,
  canSubscribeToCalendar,
} from "@/lib/community/access";
import { richTextToPlain, sanitizeRichText } from "@/lib/community/richText";
import { announcementInputSchema, eventInputSchema, shoutoutInputSchema } from "@/lib/community/validation";

const as = (role: WorkspaceRole) => ({ role });

describe("community capabilities", () => {
  it("lets only admins and owners manage announcements", () => {
    expect([canManageAnnouncements(as("OWNER")), canManageAnnouncements(as("ADMIN")), canManageAnnouncements(as("MEMBER")), canManageAnnouncements(as("GUEST"))]).toEqual([true, true, false, false]);
    expect(canManageAnnouncements(null)).toBe(false);
  });

  it("lets members create events and only the organiser or an admin edit them", () => {
    expect(canCreateEvents(as("MEMBER"))).toBe(true);
    expect(canCreateEvents(as("GUEST"))).toBe(false);
    const event = { createdById: "organiser" };
    expect(canEditEvent(as("MEMBER"), event, "organiser")).toBe(true);
    expect(canEditEvent(as("MEMBER"), event, "someone-else")).toBe(false);
    expect(canEditEvent(as("ADMIN"), event, "someone-else")).toBe(true);
    // A guest who once organised (before a role change) can no longer edit.
    expect(canEditEvent(as("GUEST"), event, "organiser")).toBe(false);
    expect(canEditEvent(as("MEMBER"), { createdById: null }, "anyone")).toBe(false);
  });

  it("lets guests reply to events and subscribe, but not give shoutouts", () => {
    expect(canRsvp(as("GUEST"))).toBe(true);
    expect(canSubscribeToCalendar(as("GUEST"))).toBe(true);
    expect(canGiveShoutouts(as("GUEST"))).toBe(false);
    expect(canGiveShoutouts(as("MEMBER"))).toBe(true);
  });

  it("lets the giver or an admin remove a shoutout", () => {
    expect(canDeleteShoutout(as("MEMBER"), { fromId: "me" }, "me")).toBe(true);
    expect(canDeleteShoutout(as("MEMBER"), { fromId: "them" }, "me")).toBe(false);
    expect(canDeleteShoutout(as("ADMIN"), { fromId: "them" }, "me")).toBe(true);
  });
});

describe("announcement rich text", () => {
  it("drops scripts, event handlers and unsafe links", () => {
    const html = sanitizeRichText('<p onclick="x()">Hi<script>alert(1)</script> <a href="javascript:alert(1)">bad</a> <a href="https://tinkerspace.in">good</a></p><img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/script|onclick|onerror|javascript:|<img/i);
    expect(html).toContain('<a href="https://tinkerspace.in" target="_blank" rel="noopener noreferrer nofollow">good</a>');
  });

  it("keeps the editor's formatting and maps big headings down", () => {
    expect(sanitizeRichText("<h1>Title</h1><ul><li><strong>Bold</strong></li></ul>")).toBe("<h2>Title</h2><ul><li><strong>Bold</strong></li></ul>");
  });

  it("turns rich text into plain text for previews", () => {
    expect(richTextToPlain("<p>Build night &amp; snacks</p><p>Bring &lt;tools&gt;</p>")).toBe("Build night & snacks\nBring <tools>");
    expect(richTextToPlain("<p></p>")).toBe("");
  });
});

describe("community input schemas", () => {
  it("requires a schedule time when scheduling", () => {
    expect(announcementInputSchema.safeParse({ title: "Hi", body: "<p>x</p>", publish: "schedule" }).success).toBe(false);
    expect(announcementInputSchema.safeParse({ title: "Hi", body: "<p>x</p>", publish: "schedule", scheduledFor: "2026-10-20T10:00" }).success).toBe(true);
  });

  it("validates event capacity and times", () => {
    const base = { title: "Build night", kind: "BUILD_NIGHT", startsAt: "2026-10-24T18:00" };
    expect(eventInputSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...base, capacity: 2.5 }).success).toBe(false);
    expect(eventInputSchema.safeParse({ ...base, capacity: null, endsAt: "" }).success).toBe(true);
    expect(eventInputSchema.safeParse({ ...base, startsAt: "tomorrow" }).success).toBe(false);
  });

  it("caps shoutout messages", () => {
    expect(shoutoutInputSchema.safeParse({ toId: "u1", message: "  " }).success).toBe(false);
    expect(shoutoutInputSchema.safeParse({ toId: "u1", message: "x".repeat(501) }).success).toBe(false);
  });
});
