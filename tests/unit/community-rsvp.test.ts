import { describe, expect, it } from "vitest";
import { countAttendance, promotionsFor, resolveRsvp, spotsLeft, waitlistPosition, type AttendeeState } from "@/lib/community/rsvp";

const at = (minute: number) => new Date(Date.UTC(2026, 9, 1, 10, minute));
const person = (userId: string, status: AttendeeState["status"], minute: number): AttendeeState => ({ userId, status, respondedAt: at(minute) });

describe("resolveRsvp", () => {
  it("passes maybe and not going straight through", () => {
    expect(resolveRsvp({ userId: "u", requested: "MAYBE", capacity: 1, attendees: [person("a", "GOING", 0)] })).toBe("MAYBE");
    expect(resolveRsvp({ userId: "u", requested: "NOT_GOING", capacity: 1, attendees: [] })).toBe("NOT_GOING");
  });

  it("lets everyone go when there is no cap", () => {
    const attendees = Array.from({ length: 50 }, (_, index) => person(`p${index}`, "GOING", index));
    expect(resolveRsvp({ userId: "u", requested: "GOING", capacity: null, attendees })).toBe("GOING");
  });

  it("fills the spots, then waitlists", () => {
    expect(resolveRsvp({ userId: "u", requested: "GOING", capacity: 2, attendees: [person("a", "GOING", 0)] })).toBe("GOING");
    expect(resolveRsvp({ userId: "u", requested: "GOING", capacity: 2, attendees: [person("a", "GOING", 0), person("b", "GOING", 1)] })).toBe("WAITLIST");
  });

  it("keeps a going member going even after the cap was lowered", () => {
    const attendees = [person("a", "GOING", 0), person("u", "GOING", 1), person("b", "GOING", 2)];
    expect(resolveRsvp({ userId: "u", requested: "GOING", capacity: 1, attendees })).toBe("GOING");
  });

  it("never lets a newcomer jump people already waiting", () => {
    // A spot is free but someone is waiting (promotion has not run yet).
    const attendees = [person("a", "GOING", 0), person("w", "WAITLIST", 1)];
    expect(resolveRsvp({ userId: "u", requested: "GOING", capacity: 2, attendees })).toBe("WAITLIST");
  });

  it("gives a free spot to the first waiting person when they reply again", () => {
    const attendees = [person("a", "GOING", 0), person("w1", "WAITLIST", 1), person("w2", "WAITLIST", 2)];
    expect(resolveRsvp({ userId: "w1", requested: "GOING", capacity: 2, attendees })).toBe("GOING");
    expect(resolveRsvp({ userId: "w2", requested: "GOING", capacity: 2, attendees })).toBe("WAITLIST");
  });

  it("frees the member's own spot when they change from going to maybe", () => {
    const attendees = [person("u", "MAYBE", 0), person("a", "GOING", 1)];
    expect(resolveRsvp({ userId: "u", requested: "GOING", capacity: 2, attendees })).toBe("GOING");
  });
});

describe("promotionsFor", () => {
  it("promotes the longest-waiting people into free spots", () => {
    const attendees = [person("a", "GOING", 0), person("w2", "WAITLIST", 5), person("w1", "WAITLIST", 3), person("w3", "WAITLIST", 7)];
    expect(promotionsFor(3, attendees)).toEqual(["w1", "w2"]);
  });

  it("promotes nobody when the event is still full", () => {
    expect(promotionsFor(1, [person("a", "GOING", 0), person("w", "WAITLIST", 1)])).toEqual([]);
  });

  it("promotes everyone when the cap is removed", () => {
    expect(promotionsFor(null, [person("w1", "WAITLIST", 1), person("w2", "WAITLIST", 2)])).toEqual(["w1", "w2"]);
  });

  it("breaks arrival ties by user id so every replica agrees", () => {
    expect(promotionsFor(1, [person("b", "WAITLIST", 1), person("a", "WAITLIST", 1)])).toEqual(["a"]);
  });
});

describe("counts and positions", () => {
  const attendees = [person("a", "GOING", 0), person("b", "MAYBE", 1), person("c", "WAITLIST", 2), person("d", "WAITLIST", 3), person("e", "NOT_GOING", 4)];

  it("counts each status", () => {
    expect(countAttendance(attendees)).toEqual({ GOING: 1, MAYBE: 1, WAITLIST: 2, NOT_GOING: 1 });
  });

  it("reports the waitlist position", () => {
    expect(waitlistPosition(attendees, "d")).toBe(2);
    expect(waitlistPosition(attendees, "a")).toBeNull();
  });

  it("never reports negative spots", () => {
    expect(spotsLeft(2, 5)).toBe(0);
    expect(spotsLeft(5, 2)).toBe(3);
    expect(spotsLeft(null, 2)).toBeNull();
  });
});
