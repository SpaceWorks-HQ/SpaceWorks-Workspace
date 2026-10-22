import { describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import {
  canManageAnnouncements,
  canSubscribeToCalendar,
} from "@/lib/community/access";
import { richTextToPlain, sanitizeRichText } from "@/lib/community/richText";
import { announcementInputSchema, feedScopeSchema } from "@/lib/community/validation";

const as = (role: WorkspaceRole) => ({ role });

describe("community capabilities", () => {
  it("lets only admins and owners manage announcements", () => {
    expect([canManageAnnouncements(as("OWNER")), canManageAnnouncements(as("ADMIN")), canManageAnnouncements(as("MEMBER")), canManageAnnouncements(as("GUEST"))]).toEqual([true, true, false, false]);
    expect(canManageAnnouncements(null)).toBe(false);
  });

});

describe("personal feed permissions", () => {
  it("allows members and guests to manage their own personal subscription", () => {
    expect(canSubscribeToCalendar(as("GUEST"))).toBe(true);
    expect(canSubscribeToCalendar(as("MEMBER"))).toBe(true);
    expect(canSubscribeToCalendar(null)).toBe(false);
    expect(feedScopeSchema.safeParse({ scope: "PERSONAL" }).success).toBe(true);
    expect(feedScopeSchema.safeParse({ scope: "WORKSPACE" }).success).toBe(false);
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

});
