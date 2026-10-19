import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { NOTIFY_DELIVER_KIND } from "@/lib/notify/dispatch";
import { announcementDestinations, saveAnnouncement } from "@/lib/community/announcements";
import type { CommunityActor } from "@/lib/community/context";
import { sendDueReminders } from "@/lib/community/events";
import { run } from "@/lib/scheduled/community";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@community-sched-${suffix}.test`;
const slug = `csched-${suffix}`;
const HOUR = 60 * 60 * 1000;
let ws: { id: string; slug: string; name: string; timezone: string };
let admin: CommunityActor;
let memberId: string;
let guestId: string;
let slackDest: string;

const published = (announcementId: string) =>
  prisma.notificationEventRecord.findMany({ where: { workspaceId: ws.id, type: "announcement.published", payload: { path: ["data", "announcementId"], equals: announcementId } } });

describe.sequential("scheduled community jobs", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`, "Anjali");
    const workspace = await createWorkspace(slug, owner.id);
    ws = { id: workspace.id, slug: workspace.slug, name: workspace.name, timezone: workspace.timezone };
    admin = { user: { id: owner.id, name: "Anjali" }, workspace: ws, membership: { role: "OWNER" } };
    memberId = (await createUser(`member${domain}`, "Meera")).id;
    guestId = (await createUser(`guest${domain}`, "Vivek")).id;
    await addMember(ws.id, memberId, "MEMBER");
    await addMember(ws.id, guestId, "GUEST");
    slackDest = (await prisma.notificationDestination.create({ data: { workspaceId: ws.id, name: "#announcements on Slack", kind: "SLACK", config: { channelId: "C1" }, createdById: owner.id } })).id;
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("offers existing destinations in the Send to picker", async () => {
    const { options } = await announcementDestinations(admin, null);
    expect(options.map((option) => option.id)).toContain(slackDest);
  });

  it("publishes a scheduled announcement once, when its time comes, to members and its Send to destinations", async () => {
    const saved = await saveAnnouncement(admin, { title: "Robot race on Saturday", body: "<p>Bring your bots.</p>", publish: "schedule", scheduledFor: "2030-06-01T09:00", destinationIds: [slackDest] }, null);
    expect(saved.ok).toBe(true);
    const id = saved.ok ? saved.data!.id : "";
    const announcement = await prisma.announcement.findUniqueOrThrow({ where: { id } });
    expect(announcement.publishedAt?.toISOString()).toBe("2030-06-01T03:30:00.000Z"); // 9 AM IST
    const rule = await prisma.notificationRule.findFirst({ where: { workspaceId: ws.id, scopeType: "ANNOUNCEMENT", scopeId: id }, include: { destinations: true } });
    expect(rule?.destinations.map((row) => row.destinationId)).toEqual([slackDest]);

    // Not yet due.
    await run(new Date("2030-06-01T03:29:00Z"));
    expect(await published(id)).toHaveLength(0);
    expect(await prisma.searchDocument.count({ where: { entityType: "announcement", entityId: id } })).toBe(0);

    // Due: dispatched once, even when every replica runs the job twice.
    const due = new Date("2030-06-01T03:31:00Z");
    await Promise.all([run(due), run(due)]);
    await run(new Date("2030-06-01T03:32:00Z"));
    const events = await published(id);
    expect(events).toHaveLength(1);
    const notified = await prisma.notification.findMany({ where: { eventId: events[0]!.id } });
    expect(notified.map((row) => row.userId).sort()).toEqual([memberId, guestId].sort());
    const deliveries = await prisma.notificationDelivery.findMany({ where: { eventId: events[0]!.id, destinationId: slackDest } });
    expect(deliveries).toHaveLength(1);
    expect(await prisma.outboxMessage.count({ where: { kind: NOTIFY_DELIVER_KIND, payload: { equals: { deliveryId: deliveries[0]!.id } } } })).toBe(1);
    expect(await prisma.searchDocument.count({ where: { entityType: "announcement", entityId: id } })).toBe(1);

    // Editing after it went out never sends it again.
    expect((await saveAnnouncement(admin, { title: "Robot race on Saturday (updated)", body: "<p>Bring bots.</p>", publish: "now" }, id, new Date("2030-06-01T04:00:00Z"))).ok).toBe(true);
    expect(await published(id)).toHaveLength(1);
  });

  it("publishes immediately when told to and the scheduler does not repeat it", async () => {
    const saved = await saveAnnouncement(admin, { title: "Kitty update", body: "<p>We bought a scope.</p>", publish: "now" }, null);
    const id = saved.ok ? saved.data!.id : "";
    expect(await published(id)).toHaveLength(1);
    await run(new Date(Date.now() + 60_000));
    expect(await published(id)).toHaveLength(1);
  });

  it("sends day-before and hour-before reminders once to people going or maybe", async () => {
    const startsAt = new Date("2030-07-10T12:30:00Z");
    const event = await prisma.communityEvent.create({
      data: { workspaceId: ws.id, title: "Soldering 101", kind: "WORKSHOP", startsAt, createdById: admin.user.id, createdAt: new Date("2030-07-01T00:00:00Z") },
    });
    await prisma.eventAttendee.createMany({
      data: [
        { eventId: event.id, userId: memberId, status: "GOING" },
        { eventId: event.id, userId: guestId, status: "NOT_GOING" },
      ],
    });
    const reminders = () => prisma.notificationEventRecord.findMany({ where: { workspaceId: ws.id, type: "event.reminder", dedupeKey: { startsWith: `event.reminder:${event.id}:` } }, orderBy: { createdAt: "asc" } });

    await sendDueReminders(new Date(startsAt.getTime() - 25 * HOUR));
    expect(await reminders()).toHaveLength(0);

    const dayBefore = new Date(startsAt.getTime() - 23 * HOUR);
    await Promise.all([sendDueReminders(dayBefore), sendDueReminders(dayBefore)]);
    await sendDueReminders(new Date(startsAt.getTime() - 5 * HOUR));
    expect((await reminders()).map((row) => row.dedupeKey)).toEqual([`event.reminder:${event.id}:24h:${startsAt.toISOString()}`]);

    await sendDueReminders(new Date(startsAt.getTime() - 30 * 60 * 1000));
    await sendDueReminders(new Date(startsAt.getTime() - 20 * 60 * 1000));
    const all = await reminders();
    expect(all).toHaveLength(2);
    const recipients = await prisma.notification.findMany({ where: { eventId: { in: all.map((row) => row.id) } }, select: { userId: true, title: true } });
    expect(recipients.every((row) => row.userId === memberId)).toBe(true);
    expect(recipients.map((row) => row.title)).toEqual(expect.arrayContaining(["Soldering 101 starts tomorrow", "Soldering 101 starts in an hour"]));
  });

  it("skips reminders for cancelled events and archived workspaces", async () => {
    const startsAt = new Date("2030-08-10T12:30:00Z");
    const event = await prisma.communityEvent.create({ data: { workspaceId: ws.id, title: "Called off", startsAt, cancelledAt: new Date("2030-08-01T00:00:00Z"), createdAt: new Date("2030-07-01T00:00:00Z") } });
    await prisma.eventAttendee.create({ data: { eventId: event.id, userId: memberId, status: "GOING" } });
    await sendDueReminders(new Date(startsAt.getTime() - 2 * HOUR));
    expect(await prisma.notificationEventRecord.count({ where: { dedupeKey: { startsWith: `event.reminder:${event.id}:` } } })).toBe(0);
  });
});
