import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deleteAnnouncement, getAnnouncement, listAnnouncements, saveAnnouncement, setAnnouncementPinned } from "@/lib/community/announcements";
import type { CommunityActor } from "@/lib/community/context";
import { cancelEvent, getEventDetail, listEvents, respondToEvent, saveEvent } from "@/lib/community/events";
import { deleteShoutout, giveShoutout, listShoutouts } from "@/lib/community/shoutouts";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@community-authz-${suffix}.test`;
const slugA = `cauthz-a-${suffix}`;
const slugB = `cauthz-b-${suffix}`;

type Ws = { id: string; slug: string; name: string; timezone: string };
let wsA: Ws;
let wsB: Ws;
const actors: Record<string, CommunityActor> = {};

function actor(userId: string, name: string, workspace: Ws, role: WorkspaceRole): CommunityActor {
  return { user: { id: userId, name }, workspace, membership: { role } };
}

const eventInput = { title: "Build night", kind: "BUILD_NIGHT", startsAt: "2030-01-10T18:00", endsAt: "2030-01-10T21:00", location: "Workshop", capacity: null };

describe.sequential("community authorization and isolation", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`, "Owner");
    const admin = await createUser(`admin${domain}`, "Admin");
    const member = await createUser(`member${domain}`, "Meera");
    const other = await createUser(`other${domain}`, "Joel");
    const guest = await createUser(`guest${domain}`, "Vivek");
    const ownerB = await createUser(`ownerb${domain}`, "Owner B");
    const a = await createWorkspace(slugA, owner.id);
    const b = await createWorkspace(slugB, ownerB.id);
    wsA = { id: a.id, slug: a.slug, name: a.name, timezone: a.timezone };
    wsB = { id: b.id, slug: b.slug, name: b.name, timezone: b.timezone };
    await addMember(wsA.id, admin.id, "ADMIN");
    await addMember(wsA.id, member.id, "MEMBER");
    await addMember(wsA.id, other.id, "MEMBER");
    await addMember(wsA.id, guest.id, "GUEST");
    actors.owner = actor(owner.id, "Owner", wsA, "OWNER");
    actors.admin = actor(admin.id, "Admin", wsA, "ADMIN");
    actors.member = actor(member.id, "Meera", wsA, "MEMBER");
    actors.other = actor(other.id, "Joel", wsA, "MEMBER");
    actors.guest = actor(guest.id, "Vivek", wsA, "GUEST");
    actors.ownerB = actor(ownerB.id, "Owner B", wsB, "OWNER");
    // Someone from B pretending to act in A (the server never resolves this, but services must still refuse).
    actors.intruder = actor(ownerB.id, "Owner B", wsA, "OWNER");
  });

  afterAll(async () => {
    await cleanup([slugA, slugB], domain);
    await prisma.$disconnect();
  });

  describe("announcements", () => {
    it("refuses members and guests", async () => {
      for (const who of [actors.member!, actors.guest!]) {
        const result = await saveAnnouncement(who, { title: "Hi", body: "<p>Hello</p>", publish: "now" }, null);
        expect(result.ok).toBe(false);
      }
      expect(await prisma.announcement.count({ where: { workspaceId: wsA.id } })).toBe(0);
    });

    it("lets an admin publish, pin and delete", async () => {
      const created = await saveAnnouncement(actors.admin!, { title: "Space closed Monday", body: "<p>Painting the walls.</p>", publish: "now", pinned: false }, null);
      expect(created.ok).toBe(true);
      const id = created.ok ? created.data!.id : "";
      expect((await setAnnouncementPinned(actors.member!, id, true)).ok).toBe(false);
      expect((await setAnnouncementPinned(actors.admin!, id, true)).ok).toBe(true);
      expect((await prisma.announcement.findUniqueOrThrow({ where: { id } })).pinned).toBe(true);
      expect(await prisma.auditEvent.count({ where: { workspaceId: wsA.id, action: { in: ["announcement.created", "announcement.pinned"] } } })).toBe(2);
      expect(await prisma.searchDocument.count({ where: { entityType: "announcement", entityId: id, workspaceId: wsA.id } })).toBe(1);
      expect((await deleteAnnouncement(actors.member!, id)).ok).toBe(false);
      expect((await deleteAnnouncement(actors.admin!, id)).ok).toBe(true);
      expect(await prisma.searchDocument.count({ where: { entityType: "announcement", entityId: id } })).toBe(0);
    });

    it("hides drafts and scheduled announcements from members and guests", async () => {
      const draft = await saveAnnouncement(actors.admin!, { title: "Draft plan", body: "<p>Shh</p>", publish: "draft" }, null);
      const later = await saveAnnouncement(actors.admin!, { title: "Later", body: "<p>Soon</p>", publish: "schedule", scheduledFor: "2030-05-01T10:00" }, null);
      expect(draft.ok && later.ok).toBe(true);
      const draftId = draft.ok ? draft.data!.id : "";
      expect(await getAnnouncement(actors.member!, draftId)).toBeNull();
      expect(await getAnnouncement(actors.guest!, draftId)).not.toBeTruthy();
      expect((await getAnnouncement(actors.admin!, draftId))?.status).toBe("draft");
      expect((await listAnnouncements(actors.member!)).map((row) => row.title)).not.toContain("Draft plan");
      expect((await listAnnouncements(actors.admin!)).map((row) => row.status).sort()).toEqual(["draft", "scheduled"]);
    });

    it("rejects a schedule time in the past and an empty body", async () => {
      const past = await saveAnnouncement(actors.admin!, { title: "Old", body: "<p>x</p>", publish: "schedule", scheduledFor: "2020-01-01T10:00" }, null);
      expect(past.ok).toBe(false);
      const empty = await saveAnnouncement(actors.admin!, { title: "Empty", body: "<p> </p>", publish: "now" }, null);
      expect(empty.ok).toBe(false);
    });

    it("never reads or edits another workspace's announcement", async () => {
      const own = await saveAnnouncement(actors.ownerB!, { title: "B news", body: "<p>Only for B</p>", publish: "now" }, null);
      const id = own.ok ? own.data!.id : "";
      expect(await getAnnouncement(actors.admin!, id)).toBeNull();
      expect((await saveAnnouncement(actors.admin!, { title: "Hijack", body: "<p>x</p>", publish: "now" }, id)).ok).toBe(false);
      expect((await deleteAnnouncement(actors.owner!, id)).ok).toBe(false);
      expect((await prisma.announcement.findUniqueOrThrow({ where: { id } })).title).toBe("B news");
    });
  });

  describe("events", () => {
    let eventId = "";

    it("lets members create events and refuses guests", async () => {
      expect((await saveEvent(actors.guest!, eventInput, null)).ok).toBe(false);
      const created = await saveEvent(actors.member!, eventInput, null);
      expect(created.ok).toBe(true);
      eventId = created.ok ? created.data!.id : "";
      const row = await prisma.communityEvent.findUniqueOrThrow({ where: { id: eventId } });
      // 6 PM in the workspace zone (Asia/Kolkata) is 12:30 UTC.
      expect(row.startsAt.toISOString()).toBe("2030-01-10T12:30:00.000Z");
      expect(await prisma.notificationEventRecord.count({ where: { workspaceId: wsA.id, type: "event.created" } })).toBe(1);
    });

    it("lets only the organiser or an admin edit and cancel", async () => {
      expect((await saveEvent(actors.other!, { ...eventInput, title: "Mine now" }, eventId)).ok).toBe(false);
      expect((await cancelEvent(actors.other!, eventId)).ok).toBe(false);
      expect((await cancelEvent(actors.guest!, eventId)).ok).toBe(false);
      expect((await saveEvent(actors.member!, { ...eventInput, title: "Build night v2" }, eventId)).ok).toBe(true);
      expect((await saveEvent(actors.admin!, { ...eventInput, title: "Build night v3" }, eventId)).ok).toBe(true);
      expect((await getEventDetail(actors.other!, eventId))?.canEdit).toBe(false);
      expect((await getEventDetail(actors.member!, eventId))?.canEdit).toBe(true);
    });

    it("rejects an end before the start", async () => {
      const result = await saveEvent(actors.member!, { ...eventInput, endsAt: "2030-01-10T17:00" }, null);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.fieldErrors?.endsAt).toBeTruthy();
    });

    it("lets guests RSVP (they can come to build nights)", async () => {
      const reply = await respondToEvent(actors.guest!, { eventId, status: "GOING" });
      expect(reply.ok && reply.data?.status).toBe("GOING");
    });

    it("keeps events inside their workspace", async () => {
      expect(await getEventDetail(actors.ownerB!, eventId)).toBeNull();
      expect((await respondToEvent(actors.ownerB!, { eventId, status: "GOING" })).ok).toBe(false);
      expect((await saveEvent(actors.ownerB!, eventInput, eventId)).ok).toBe(false);
      expect((await cancelEvent(actors.ownerB!, eventId)).ok).toBe(false);
      const listed = await listEvents(actors.ownerB!, { start: new Date("2029-12-01T00:00:00Z"), end: new Date("2030-02-01T00:00:00Z") });
      expect(listed).toHaveLength(0);
      expect(await prisma.eventAttendee.count({ where: { eventId, userId: actors.ownerB!.user.id } })).toBe(0);
    });

    it("closes replies once cancelled and refuses edits", async () => {
      expect((await cancelEvent(actors.member!, eventId)).ok).toBe(true);
      expect((await respondToEvent(actors.other!, { eventId, status: "GOING" })).ok).toBe(false);
      expect((await saveEvent(actors.admin!, eventInput, eventId)).ok).toBe(false);
      // The guest who was going hears about the cancellation.
      const note = await prisma.notification.findFirst({ where: { userId: actors.guest!.user.id, kind: "event.changed" } });
      expect(note?.title).toMatch(/cancelled/);
    });
  });

  describe("shoutouts", () => {
    it("refuses guests and self-shoutouts", async () => {
      expect((await giveShoutout(actors.guest!, { toId: actors.member!.user.id, message: "Thanks" })).ok).toBe(false);
      expect((await giveShoutout(actors.member!, { toId: actors.member!.user.id, message: "Me" })).ok).toBe(false);
    });

    it("refuses recipients from another workspace", async () => {
      expect((await giveShoutout(actors.member!, { toId: actors.ownerB!.user.id, message: "Hi" })).ok).toBe(false);
    });

    it("notifies the recipient and lets only the giver or an admin remove it", async () => {
      const given = await giveShoutout(actors.member!, { toId: actors.other!.user.id, message: "For fixing the printer." });
      expect(given.ok).toBe(true);
      const id = given.ok ? given.data!.id : "";
      const note = await prisma.notification.findFirst({ where: { userId: actors.other!.user.id, kind: "shoutout.received" } });
      expect(note?.title).toBe("Meera gave you a shoutout");
      expect((await listShoutouts(actors.guest!, { personId: actors.other!.user.id })).map((row) => row.id)).toContain(id);
      expect((await listShoutouts(actors.ownerB!)).map((row) => row.id)).not.toContain(id);
      expect((await deleteShoutout(actors.other!, id)).ok).toBe(false);
      expect((await deleteShoutout(actors.ownerB!, id)).ok).toBe(false);
      expect((await deleteShoutout(actors.admin!, id)).ok).toBe(true);
    });
  });

  it("refuses everything for an actor whose workspace does not hold the record", async () => {
    // intruder claims workspace A but the record lookups are still scoped by workspace id.
    const bAnnouncement = await prisma.announcement.findFirstOrThrow({ where: { workspaceId: wsB.id } });
    expect(await getAnnouncement(actors.intruder!, bAnnouncement.id)).toBeNull();
  });
});
