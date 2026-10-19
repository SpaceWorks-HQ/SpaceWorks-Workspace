import { describe, expect, it } from "vitest";
import { DESTINATION_ADAPTERS, PERSONAL_CHANNEL_ADAPTERS } from "@/lib/notify/adapters";
import { retryDelayMs } from "@/lib/notify/deliver";

describe("destination adapter registry", () => {
  it("registers one adapter per queued destination kind, keyed by its own kind", () => {
    for (const [kind, adapter] of Object.entries(DESTINATION_ADAPTERS)) expect(adapter.kind).toBe(kind);
  });

  it("routes each personal channel to the adapter that declares it", () => {
    for (const [channel, adapter] of Object.entries(PERSONAL_CHANNEL_ADAPTERS)) expect(adapter.personalChannel).toBe(channel);
  });

  it("ships email and workspace channels built in, other providers as not-configured placeholders", () => {
    expect(DESTINATION_ADAPTERS.EMAIL.configured).toBe(true);
    expect(DESTINATION_ADAPTERS.WORKSPACE_CHANNEL.configured).toBe(true);
    for (const kind of ["SLACK", "DISCORD", "MATTERMOST", "TELEGRAM", "WHATSAPP", "WEBHOOK"] as const) {
      expect(DESTINATION_ADAPTERS[kind].configured, kind).toBe(false);
    }
  });

  it("placeholders fail permanently with a clear reason", async () => {
    const result = await DESTINATION_ADAPTERS.SLACK.send({} as never);
    expect(result).toEqual({ ok: false, retryable: false, error: "Slack delivery is not configured yet." });
  });
});

describe("delivery retry backoff", () => {
  it("steps 30 s, 2 m, 10 m, 30 m, 2 h, 6 h and honours Retry-After", () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((attempt) => retryDelayMs(attempt) / 1000)).toEqual([30, 120, 600, 1800, 7200, 21600, 21600]);
    expect(retryDelayMs(1, 45)).toBe(45_000);
  });
});
