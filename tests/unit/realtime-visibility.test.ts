import { describe, expect, it } from "vitest";
import { isEventVisibleTo, type RealtimeEvent } from "@/lib/realtimeTypes";

const base: RealtimeEvent = { type: "message.created", channel: "channel:c1", at: "2026-10-19T00:00:00.000Z" };

describe("realtime event filtering", () => {
  it("delivers workspace events to every member", () => {
    expect(isEventVisibleTo(base, "u1")).toBe(true);
  });

  it("restricts audience-scoped events", () => {
    const event = { ...base, audience: ["u1", "u2"] };
    expect(isEventVisibleTo(event, "u1")).toBe(true);
    expect(isEventVisibleTo(event, "u3")).toBe(false);
  });

  it("keeps user streams private", () => {
    const event = { ...base, type: "notification.created", channel: "user:u1" };
    expect(isEventVisibleTo(event, "u1")).toBe(true);
    expect(isEventVisibleTo(event, "u2")).toBe(false);
  });
});
