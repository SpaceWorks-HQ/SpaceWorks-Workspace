import { describe, expect, it } from "vitest";
import { destinationTarget, isDuplicate, partitionDuplicates, personalTarget } from "@/lib/notify/dedupe";
import { EVENT_CATALOG, EVENT_TYPES, NOTIFY_CATEGORIES, eventTypesByCategory, isEventType } from "@/lib/notify/events";
import { eventTypeMatches, meetsSeverity, ruleMatchesEvent, selectBroadcastTargets, type MatchableRule } from "@/lib/notify/match";
import { availablePersonalChannels, digestDueAt, resolvePersonalChannels } from "@/lib/notify/preferences";
import { deliveryTime, parseQuietHours, quietHoursEnd } from "@/lib/notify/quietHours";
import { absoluteAppUrl, renderMessage, renderPlainText } from "@/lib/notify/render";
import { SCOPE_KEYS } from "@/lib/notify/types";

const rule = (overrides: Partial<MatchableRule> = {}): MatchableRule => ({
  id: "r1",
  enabled: true,
  scopeType: "WORKSPACE",
  scopeId: null,
  eventTypes: ["monitor.*"],
  minSeverity: "INFO",
  filters: {},
  quietHours: null,
  criticalBypassesQuiet: true,
  dedupeWindowSec: 300,
  ...overrides,
});

describe("event catalogue", () => {
  it("gives every event a known category and a sentence-case label", () => {
    for (const type of EVENT_TYPES) {
      const spec = EVENT_CATALOG[type];
      expect(NOTIFY_CATEGORIES[spec.category], type).toBeDefined();
      expect(spec.label[0], type).toBe(spec.label[0]!.toUpperCase());
      expect(type, "lowercase dotted names").toMatch(/^[a-z_]+(\.[a-z_]+)*$/);
    }
  });

  it("covers every area the later builds notify about", () => {
    for (const type of [
      "task.assigned",
      "task.due",
      "mention",
      "message.dm",
      "announcement.published",
      "finance.approval.requested",
      "finance.approval.decided",
      "monitor.down",
      "monitor.up",
      "incident.opened",
      "incident.resolved",
      "cert.expiring",
      "renewal.due",
      "github.pr.opened",
      "digest.ready",
      "assistant.job.completed",
      "vault.access.requested",
    ]) {
      expect(isEventType(type), type).toBe(true);
    }
    expect(isEventType("nope.nothing")).toBe(false);
  });

  it("groups every type under exactly one category", () => {
    const grouped = eventTypesByCategory();
    expect(Object.values(grouped).flat().sort()).toEqual([...EVENT_TYPES].sort());
  });
});

describe("rule matching", () => {
  it("matches exact types, prefixes and the wildcard", () => {
    expect(eventTypeMatches("monitor.down", "monitor.down")).toBe(true);
    expect(eventTypeMatches("monitor.*", "monitor.down")).toBe(true);
    expect(eventTypeMatches("finance.*", "finance.approval.requested")).toBe(true);
    expect(eventTypeMatches("monitor.*", "monitoring.down")).toBe(false);
    expect(eventTypeMatches("monitor.down", "monitor.up")).toBe(false);
    expect(eventTypeMatches("*", "anything.at.all")).toBe(true);
  });

  it("respects minimum severity", () => {
    expect(meetsSeverity("critical", "WARNING")).toBe(true);
    expect(meetsSeverity("info", "WARNING")).toBe(false);
    expect(ruleMatchesEvent(rule({ minSeverity: "CRITICAL" }), { type: "monitor.degraded", severity: "warning" })).toBe(false);
    expect(ruleMatchesEvent(rule({ minSeverity: "CRITICAL" }), { type: "monitor.down", severity: "critical" })).toBe(true);
  });

  it("skips disabled rules", () => {
    expect(ruleMatchesEvent(rule({ enabled: false }), { type: "monitor.down", severity: "critical" })).toBe(false);
  });

  it("applies scoped rules only to their own entity", () => {
    const scoped = rule({ scopeType: "MONITOR", scopeId: "mon_1", eventTypes: ["*"] });
    expect(ruleMatchesEvent(scoped, { type: "monitor.down", severity: "critical", scope: { monitorId: "mon_1" } })).toBe(true);
    expect(ruleMatchesEvent(scoped, { type: "monitor.down", severity: "critical", scope: { monitorId: "mon_2" } })).toBe(false);
    expect(ruleMatchesEvent(scoped, { type: "monitor.down", severity: "critical" })).toBe(false);
  });

  it("drops workspace rules when the entity opted out", () => {
    expect(ruleMatchesEvent(rule(), { type: "monitor.down", severity: "critical", useWorkspaceRules: false })).toBe(false);
    const scoped = rule({ scopeType: "MONITOR", scopeId: "mon_1" });
    expect(ruleMatchesEvent(scoped, { type: "monitor.down", severity: "critical", scope: { monitorId: "mon_1" }, useWorkspaceRules: false })).toBe(true);
  });

  it("requires every non-empty filter to match", () => {
    const filtered = rule({ eventTypes: ["task.*"], filters: { projectIds: ["p1"], tagsAny: ["infra", "web"] } });
    expect(ruleMatchesEvent(filtered, { type: "task.assigned", severity: "info", scope: { projectId: "p1", tags: ["web"] } })).toBe(true);
    expect(ruleMatchesEvent(filtered, { type: "task.assigned", severity: "info", scope: { projectId: "p2", tags: ["web"] } })).toBe(false);
    expect(ruleMatchesEvent(filtered, { type: "task.assigned", severity: "info", scope: { projectId: "p1" } })).toBe(false);
  });

  it("maps every scoped rule type to an event scope key", () => {
    expect(Object.values(SCOPE_KEYS).every((key) => key.endsWith("Id"))).toBe(true);
  });

  it("unions destinations across rules with the most permissive timing", () => {
    const now = new Date("2026-10-19T17:30:00Z"); // 23:00 in Kochi
    const quiet = { start: "22:00", end: "07:00", tz: "Asia/Kolkata" };
    const targets = selectBroadcastTargets(
      [
        { ...rule({ id: "quiet", quietHours: quiet, dedupeWindowSec: 600 }), destinationIds: ["d1", "d2"] },
        { ...rule({ id: "loud", eventTypes: ["monitor.degraded"], dedupeWindowSec: 120 }), destinationIds: ["d2"] },
        { ...rule({ id: "other", eventTypes: ["task.*"] }), destinationIds: ["d3"] },
      ],
      { type: "monitor.degraded", severity: "warning" },
      now,
    );
    const byId = Object.fromEntries(targets.map((target) => [target.destinationId, target]));
    expect(Object.keys(byId).sort()).toEqual(["d1", "d2"]);
    expect(byId.d1!.scheduledFor.toISOString()).toBe("2026-10-20T01:30:00.000Z"); // 07:00 Kochi
    expect(byId.d2!.scheduledFor).toEqual(now);
    expect(byId.d2!.ruleId).toBe("loud");
    expect(byId.d2!.dedupeWindowSec).toBe(120);
  });
});

describe("quiet hours", () => {
  const overnight = { start: "22:00", end: "07:00", tz: "Asia/Kolkata" };

  it("validates stored settings", () => {
    expect(parseQuietHours(overnight)).toEqual(overnight);
    expect(parseQuietHours({ ...overnight, days: [1, 9, 2] })).toEqual({ ...overnight, days: [1, 2] });
    expect(parseQuietHours({ start: "25:00", end: "07:00", tz: "UTC" })).toBeNull();
    expect(parseQuietHours({ start: "22:00", end: "07:00", tz: "Mars/Base" })).toBeNull();
    expect(parseQuietHours(null)).toBeNull();
  });

  it("finds the end of an overnight window on both sides of midnight", () => {
    // 23:30 IST
    expect(quietHoursEnd(overnight, new Date("2026-10-19T18:00:00Z"))?.toISOString()).toBe("2026-10-20T01:30:00.000Z");
    // 03:15 IST
    expect(quietHoursEnd(overnight, new Date("2026-10-19T21:45:00Z"))?.toISOString()).toBe("2026-10-20T01:30:00.000Z");
    // 12:00 IST
    expect(quietHoursEnd(overnight, new Date("2026-10-20T06:30:00Z"))).toBeNull();
    // exactly 07:00 IST is outside
    expect(quietHoursEnd(overnight, new Date("2026-10-20T01:30:00Z"))).toBeNull();
  });

  it("handles same-day windows and weekday limits", () => {
    const lunch = { start: "12:00", end: "13:00", tz: "UTC", days: [1] }; // Mondays only
    expect(quietHoursEnd(lunch, new Date("2026-10-19T12:20:00Z"))?.toISOString()).toBe("2026-10-19T13:00:00.000Z"); // Monday
    expect(quietHoursEnd(lunch, new Date("2026-10-20T12:20:00Z"))).toBeNull(); // Tuesday
    const fridayNights = { start: "22:00", end: "06:00", tz: "UTC", days: [5] };
    expect(quietHoursEnd(fridayNights, new Date("2026-10-24T02:00:00Z"))?.toISOString()).toBe("2026-10-24T06:00:00.000Z"); // Sat 02:00, started Fri
    expect(quietHoursEnd(fridayNights, new Date("2026-10-25T02:00:00Z"))).toBeNull(); // Sun 02:00, started Sat
  });

  it("treats an empty window as off", () => {
    expect(quietHoursEnd({ start: "09:00", end: "09:00", tz: "UTC" }, new Date("2026-10-19T09:00:00Z"))).toBeNull();
  });

  it("lets critical events through unless the bypass is off, and honours snooze", () => {
    const at = new Date("2026-10-19T18:00:00Z");
    expect(deliveryTime({ at, severity: "critical", quietHours: overnight })).toEqual(at);
    expect(deliveryTime({ at, severity: "critical", quietHours: overnight, criticalBypasses: false }).toISOString()).toBe("2026-10-20T01:30:00.000Z");
    expect(deliveryTime({ at, severity: "info", quietHours: overnight }).toISOString()).toBe("2026-10-20T01:30:00.000Z");
    const snoozed = new Date("2026-10-19T19:00:00Z");
    expect(deliveryTime({ at, severity: "info", snoozedUntil: snoozed })).toEqual(snoozed);
    expect(deliveryTime({ at, severity: "info" })).toEqual(at);
  });
});

describe("dedupe", () => {
  const now = new Date("2026-10-19T10:00:00Z");
  const prior = [
    { target: destinationTarget("d1"), at: new Date("2026-10-19T09:57:00Z") },
    { target: personalTarget("u1", "EMAIL"), at: new Date("2026-10-19T09:00:00Z") },
  ];

  it("drops a repeat to the same target inside the window only", () => {
    expect(isDuplicate({ target: destinationTarget("d1"), windowSec: 300 }, prior, now)).toBe(true);
    expect(isDuplicate({ target: destinationTarget("d1"), windowSec: 60 }, prior, now)).toBe(false);
    expect(isDuplicate({ target: destinationTarget("d2"), windowSec: 3600 }, prior, now)).toBe(false);
    expect(isDuplicate({ target: personalTarget("u1", "EMAIL"), windowSec: 3600 }, prior, now)).toBe(true);
    expect(isDuplicate({ target: personalTarget("u1", "IN_APP"), windowSec: 3600 }, prior, now)).toBe(false);
  });

  it("partitions candidates", () => {
    const { kept, dropped } = partitionDuplicates(
      [
        { target: destinationTarget("d1"), windowSec: 300 },
        { target: destinationTarget("d2"), windowSec: 300 },
      ],
      prior,
      now,
    );
    expect(kept.map((c) => c.target)).toEqual(["destination:d2"]);
    expect(dropped.map((c) => c.target)).toEqual(["destination:d1"]);
  });
});

describe("member preferences", () => {
  it("falls back from member row to workspace default to catalogue default", () => {
    const base = { category: "finance" as const, role: "MEMBER" as const, linkedProviders: [] };
    expect(resolvePersonalChannels(base).channels.sort()).toEqual(["EMAIL", "IN_APP"]);
    expect(resolvePersonalChannels({ ...base, workspaceDefault: { channels: ["IN_APP"], digestFrequency: "DAILY" } })).toEqual({ channels: ["IN_APP"], digestFrequency: "DAILY" });
    expect(
      resolvePersonalChannels({
        ...base,
        userPreference: { channels: ["EMAIL"], digestFrequency: "IMMEDIATE" },
        workspaceDefault: { channels: ["IN_APP"], digestFrequency: "DAILY" },
      }),
    ).toEqual({ channels: ["IN_APP", "EMAIL"], digestFrequency: "IMMEDIATE" });
  });

  it("only offers DM channels the member has linked, and never to guests", () => {
    expect([...availablePersonalChannels("MEMBER", ["TELEGRAM"])].sort()).toEqual(["EMAIL", "IN_APP", "TELEGRAM_DM"]);
    expect([...availablePersonalChannels("GUEST", ["TELEGRAM", "SLACK"])].sort()).toEqual(["EMAIL", "IN_APP"]);
    const resolved = resolvePersonalChannels({
      category: "tasks",
      role: "MEMBER",
      userPreference: { channels: ["IN_APP", "TELEGRAM_DM", "SLACK_DM"], digestFrequency: "IMMEDIATE" },
      linkedProviders: ["TELEGRAM"],
    });
    expect(resolved.channels.sort()).toEqual(["IN_APP", "TELEGRAM_DM"]);
  });

  it("computes digest due times", () => {
    const now = new Date("2026-10-19T10:20:00Z");
    expect(digestDueAt("IMMEDIATE", now)).toBeNull();
    expect(digestDueAt("HOURLY", now)?.toISOString()).toBe("2026-10-19T11:00:00.000Z");
    expect(digestDueAt("DAILY", now)?.toISOString()).toBe("2026-10-20T10:00:00.000Z");
  });
});

describe("rendering", () => {
  const workspace = { id: "w1", slug: "kochi", name: "TinkerSpace Kochi" };

  it("only links app-relative paths", () => {
    expect(absoluteAppUrl("/w/kochi/services", "https://work.example.org")).toBe("https://work.example.org/w/kochi/services");
    expect(absoluteAppUrl("https://evil.example", "https://work.example.org")).toBeNull();
    expect(absoluteAppUrl("//evil.example", "https://work.example.org")).toBeNull();
  });

  it("renders a channel-neutral message with a severity word", () => {
    const message = renderMessage(
      { type: "monitor.down", severity: "critical", title: "Equipment monitor is down", body: "Timed out after 10 s.", url: "/w/kochi/services", fields: [{ label: "Status", value: "504" }] },
      workspace,
      "https://work.example.org",
    );
    expect(message.severityLabel).toBe("Critical");
    expect(message.url).toBe("https://work.example.org/w/kochi/services");
    expect(message.text).toBe("Timed out after 10 s.\nStatus: 504");
    expect(renderPlainText(message)).toBe("[Critical] Equipment monitor is down\nTimed out after 10 s.\nStatus: 504\nhttps://work.example.org/w/kochi/services");
  });
});
