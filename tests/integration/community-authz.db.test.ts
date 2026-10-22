import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deleteAnnouncement, getAnnouncement, listAnnouncements, saveAnnouncement, setAnnouncementPinned } from "@/lib/community/announcements";
import type { CommunityActor } from "@/lib/community/context";
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

});
