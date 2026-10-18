import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@/lib/realtimeTypes";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function bus(redisUrl: string) {
  vi.stubEnv("REDIS_URL", redisUrl);
  return import("@/lib/realtime");
}

async function roundTrip(redisUrl: string) {
  const { publish, publishToUser, subscribe } = await bus(redisUrl);
  const received: RealtimeEvent[] = [];
  const unsubscribe = await subscribe("ws_rt_test", (event) => received.push(event));
  await publish("ws_rt_test", "channel:c1", { type: "message.created", data: { messageId: "m1" } });
  await publishToUser("ws_rt_test", "u1", { type: "notification.created" });
  await publish("ws_other", "workspace", { type: "task.updated" });
  await new Promise((resolve) => setTimeout(resolve, redisUrl ? 300 : 0));
  unsubscribe();
  await publish("ws_rt_test", "workspace", { type: "after.unsubscribe" });
  await new Promise((resolve) => setTimeout(resolve, redisUrl ? 200 : 0));
  return received;
}

describe("realtime bus", () => {
  it("delivers workspace events in-process without Redis", async () => {
    const received = await roundTrip("");
    expect(received.map((e) => e.type)).toEqual(["message.created", "notification.created"]);
    expect(received[0]).toMatchObject({ channel: "channel:c1", data: { messageId: "m1" } });
    expect(received[1]).toMatchObject({ channel: "user:u1", audience: ["u1"] });
    expect(typeof received[0]!.at).toBe("string");
  });

  it.skipIf(!process.env.TEST_REDIS_URL)("delivers through Redis pub/sub", async () => {
    const received = await roundTrip(process.env.TEST_REDIS_URL!);
    expect(received.map((e) => e.type)).toEqual(["message.created", "notification.created"]);
  });
});
