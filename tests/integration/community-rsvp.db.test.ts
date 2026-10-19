import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { WorkspaceRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CommunityActor } from "@/lib/community/context";
import { respondToEvent, saveEvent } from "@/lib/community/events";
import { addMember, cleanup, createUser, createWorkspace, uniqueSuffix } from "../helpers/fixtures";

const suffix = uniqueSuffix();
const domain = `@community-rsvp-${suffix}.test`;
const slug = `crsvp-${suffix}`;
let ws: { id: string; slug: string; name: string; timezone: string };
const people: CommunityActor[] = [];

const actor = (id: string, name: string, role: WorkspaceRole): CommunityActor => ({ user: { id, name }, workspace: ws, membership: { role } });
const statusOf = async (eventId: string, userId: string) => (await prisma.eventAttendee.findUnique({ where: { eventId_userId: { eventId, userId } } }))?.status ?? null;

async function newEvent(capacity: number | null) {
  const result = await saveEvent(people[0]!, { title: `Workshop ${Math.random()}`, kind: "WORKSHOP", startsAt: "2030-03-01T10:00", capacity }, null);
  if (!result.ok) throw new Error(result.error);
  return result.data!.id;
}

describe.sequential("RSVP capacity and waitlist", () => {
  beforeAll(async () => {
    const owner = await createUser(`owner${domain}`, "Organiser");
    const workspace = await createWorkspace(slug, owner.id);
    ws = { id: workspace.id, slug: workspace.slug, name: workspace.name, timezone: workspace.timezone };
    people.push(actor(owner.id, "Organiser", "OWNER"));
    for (const name of ["Asha", "Bilal", "Chitra", "Dev", "Esha"]) {
      const user = await createUser(`${name.toLowerCase()}${domain}`, name);
      await addMember(ws.id, user.id, name === "Esha" ? "GUEST" : "MEMBER");
      people.push(actor(user.id, name, name === "Esha" ? "GUEST" : "MEMBER"));
    }
  });

  afterAll(async () => {
    await cleanup([slug], domain);
    await prisma.$disconnect();
  });

  it("fills spots, waitlists the rest and promotes in arrival order", async () => {
    const eventId = await newEvent(2);
    const [, asha, bilal, chitra, dev] = people;
    for (const who of [asha!, bilal!]) expect((await respondToEvent(who, { eventId, status: "GOING" })).ok).toBe(true);
    const third = await respondToEvent(chitra!, { eventId, status: "GOING" }, new Date(Date.now() + 1000));
    expect(third.ok && third.data).toEqual({ status: "WAITLIST", waitlistPosition: 1 });
    const fourth = await respondToEvent(dev!, { eventId, status: "GOING" }, new Date(Date.now() + 2000));
    expect(fourth.ok && fourth.data).toEqual({ status: "WAITLIST", waitlistPosition: 2 });

    // Asha drops out: Chitra (first in line) gets the spot and is told.
    expect((await respondToEvent(asha!, { eventId, status: "NOT_GOING" }, new Date(Date.now() + 3000))).ok).toBe(true);
    expect(await statusOf(eventId, chitra!.user.id)).toBe("GOING");
    expect(await statusOf(eventId, dev!.user.id)).toBe("WAITLIST");
    const note = await prisma.notification.findFirst({ where: { userId: chitra!.user.id, kind: "rsvp.changed" } });
    expect(note?.title).toMatch(/spot opened up/);
    expect(await prisma.notification.count({ where: { userId: dev!.user.id, kind: "rsvp.changed" } })).toBe(0);

    // Changing from going to maybe frees a spot too.
    await respondToEvent(bilal!, { eventId, status: "MAYBE" }, new Date(Date.now() + 4000));
    expect(await statusOf(eventId, dev!.user.id)).toBe("GOING");
    expect(await prisma.eventAttendee.count({ where: { eventId, status: "GOING" } })).toBe(2);
  });

  it("promotes the waitlist when the organiser raises or removes the cap", async () => {
    const eventId = await newEvent(1);
    const [organiser, asha, bilal, chitra] = people;
    await respondToEvent(asha!, { eventId, status: "GOING" });
    await respondToEvent(bilal!, { eventId, status: "GOING" }, new Date(Date.now() + 1000));
    await respondToEvent(chitra!, { eventId, status: "GOING" }, new Date(Date.now() + 2000));
    expect(await prisma.eventAttendee.count({ where: { eventId, status: "WAITLIST" } })).toBe(2);
    const base = { title: "Workshop", kind: "WORKSHOP", startsAt: "2030-03-01T10:00" };
    expect((await saveEvent(organiser!, { ...base, capacity: 2 }, eventId)).ok).toBe(true);
    expect(await statusOf(eventId, bilal!.user.id)).toBe("GOING");
    expect(await statusOf(eventId, chitra!.user.id)).toBe("WAITLIST");
    // Lowering the cap never bumps anyone already going.
    expect((await saveEvent(organiser!, { ...base, capacity: 1 }, eventId)).ok).toBe(true);
    expect(await prisma.eventAttendee.count({ where: { eventId, status: "GOING" } })).toBe(2);
    expect((await saveEvent(organiser!, { ...base, capacity: null }, eventId)).ok).toBe(true);
    expect(await statusOf(eventId, chitra!.user.id)).toBe("GOING");
  });

  it("never oversells the last spot under concurrent replies", async () => {
    const eventId = await newEvent(1);
    const results = await Promise.all(people.slice(1).map((who) => respondToEvent(who, { eventId, status: "GOING" })));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await prisma.eventAttendee.count({ where: { eventId, status: "GOING" } })).toBe(1);
    expect(await prisma.eventAttendee.count({ where: { eventId, status: "WAITLIST" } })).toBe(people.length - 2);
  });

  it("closes replies once the event has started", async () => {
    const eventId = await newEvent(null);
    const result = await respondToEvent(people[1]!, { eventId, status: "GOING" }, new Date("2030-03-01T05:00:00Z"));
    expect(result.ok).toBe(false);
  });
});
