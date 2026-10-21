import { expect, it } from "vitest";
import { prisma } from "@/lib/db";
import {
  saveEntry,
} from "@/lib/calendar/service";
import { searchDocuments } from "@/lib/search/query";
import { createFeed, resolveFeedToken, buildFeed } from "@/lib/community/feeds";
import { attachCalendarFile } from "@/lib/calendar/files";
import { findDownloadableFile } from "@/lib/files";
import { libraryWhere } from "@/lib/files/service";
import {
  suffix,
  owner,
  member,
  guest,
  other,
  start,
  calendar,
  records,
} from "./fixtures";

export function registerPersonalEntryTests() {
  it("keeps personal reminders owner-only in the calendar and live search", async () => {
    records.entryId = (
      await saveEntry(member, {
        title: `PrivateReminder${suffix}`,
        kind: "REMINDER",
        startsAt: start,
        until: start,
        timezone: "Asia/Kolkata",
      })
    ).id;
    expect(
      (await calendar(member)).items.some((i) => i.sourceId === records.entryId),
    ).toBe(true);
    expect(
      (await calendar(owner)).items.some((i) => i.sourceId === records.entryId),
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
      ).some((h) => h.entityId === records.entryId),
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
      records.entryId,
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
        records.entryId,
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
}
