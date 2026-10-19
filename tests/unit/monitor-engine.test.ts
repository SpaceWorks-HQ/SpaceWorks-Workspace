import { describe, expect, it } from "vitest";
import { evaluateAssertions, isSafeRegex, parseAssertion, parseExpectedStatus } from "@/lib/monitor/assertions";
import { checkAddress, checkHostname, isBlockedAddress, normalizeAllowlistEntry, pinnedLookup, resolveTarget, STRICT_POLICY } from "@/lib/monitor/ssrf";
import { nextMonitorState, type MachineMonitor } from "@/lib/monitor/stateMachine";
import { dailyBars, mergeRollups, percentileCont, summarizeChecks, uptimePercent } from "@/lib/monitor/stats";
import { crossedThreshold, daysUntil, expiryStatus, parseRdapBootstrap, rdapBaseFor, rdapExpiration, rdapRegistrar } from "@/lib/monitor/expiry";
import { isOverdue, nextExpectedAt, parsePingAction, pingOutcome, validateCron } from "@/lib/monitor/heartbeat";
import { heartbeatConfigSchema, parseMonitorConfig } from "@/lib/monitor/schemas";
import { activeOccurrence, parseRrule } from "@/lib/monitor/maintenance";
import { aggregateCosts } from "@/lib/monitor/cloud/costs";

const at = new Date("2026-10-19T12:00:00Z");
describe("monitor evaluators", () => {
  it.each([
    ['[STATUS] == any(200, 204)', { status: 204 }, true],
    ['[BODY].items[0].status == "healthy"', { body: '{"items":[{"status":"healthy"}]}' }, true],
    ['[BODY].missing == true', { body: '{}' }, false],
    ['[HEADER].content-type contains "json"', { headers: { 'Content-Type': 'application/json' } }, true],
    ['[RESPONSE_TIME] < 800', { responseTimeMs: 900 }, false],
    ['[CERTIFICATE_EXPIRATION] > 14d', { certExpiresInMs: 15 * 86400000 }, true],
    ['[BODY] !contains "error"', { body: 'healthy' }, true],
  ])("evaluates %s", (expr, context, passed) => { expect(evaluateAssertions([expr], context)[0].passed).toBe(passed); });
  it("rejects executable expressions and expensive patterns", () => {
    expect(parseAssertion('process.exit()').ok).toBe(false); expect(parseAssertion('[BODY] matches /ok/ii').ok).toBe(false);
    expect(isSafeRegex('(a+)+$')).toBe(false);
    expect(isSafeRegex('a*a*')).toBe(false); expect(isSafeRegex('a+b')).toBe(false); expect(isSafeRegex('^a+b$')).toBe(true);
    expect(isSafeRegex('healthy|ready')).toBe(true);
  });
  it("matches configured status ranges", () => { const matches = parseExpectedStatus('200-299, 304'); expect(matches(201)).toBe(true); expect(matches(304)).toBe(true); expect(matches(302)).toBe(false); });
  it("validates expiry thresholds", () => { expect(parseMonitorConfig('TLS_CERT', { host: 'example.com', criticalDays: 30, warnDays: 20 }).success).toBe(false); });
});
describe("monitor network policy", () => {
  it.each(['0.0.0.0', '127.0.0.1', '10.2.3.4', '172.16.2.3', '192.168.1.1', '169.254.169.254', '100.64.1.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2002:a00:1::', 'fec0::1', '64:ff9b:1::a00:1'])('blocks %s', address => { expect(isBlockedAddress(address)).toBe(true); expect(checkAddress(address, STRICT_POLICY).ok).toBe(false); });
  it("requires instance consent and workspace allowlisting for private networks", () => {
    expect(checkAddress('10.2.3.4', { allowPrivate: true, allowlist: [] }).ok).toBe(false);
    expect(checkAddress('10.2.3.4', { allowPrivate: false, allowlist: ['10.0.0.0/8'] }).ok).toBe(false);
    expect(checkAddress('10.2.3.4', { allowPrivate: true, allowlist: ['10.0.0.0/8'] }).ok).toBe(true);
    expect(checkAddress('169.254.169.254', { allowPrivate: true, allowlist: ['169.254.0.0/16'] }).ok).toBe(false);
    expect(checkAddress('fd00:0ec2:0:0:0:0:0:0254', { allowPrivate: true, allowlist: ['fd00::/16'] }).ok).toBe(false);
    expect(checkHostname('metadata.google.internal', { allowPrivate: true, allowlist: ['*.google.internal'] }).ok).toBe(false);
    expect(normalizeAllowlistEntry('10.0.0.0/0')).toBeNull();
  });
  it("rejects mixed public/private DNS answers", async () => { expect((await resolveTarget('example.com', STRICT_POLICY, async () => [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }])).ok).toBe(false); });
  it("pins the validated address without another DNS lookup", async () => {
    const resolved = await resolveTarget('example.com', STRICT_POLICY, async () => [{ address: '1.1.1.1', family: 4 }]);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const lookup = pinnedLookup(resolved.addresses[0]);
    lookup('different.example.com', {}, (error, address, family) => { expect(error).toBeNull(); expect(address).toBe('1.1.1.1'); expect(family).toBe(4); });
  });
});
const monitor: MachineMonitor = { lastStatus: 'UP', consecutiveFailures: 0, consecutiveSuccesses: 0, failureThreshold: 3, successThreshold: 2, incidentOnDegraded: false, flapping: false, intervalSec: 60 };
const transition = (changes: Partial<MachineMonitor>, outcome: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN', hasOpenIncident = false, inMaintenance = false, recentIncidentCount = 0) => nextMonitorState({ monitor: { ...monitor, ...changes }, outcome, hasOpenIncident, inMaintenance, recentIncidentCount });
describe("monitor incident confirmation and flapping", () => {
  it("opens only at the consecutive failure threshold", () => { expect(transition({ consecutiveFailures: 1 }, 'DOWN').openIncident).toBe(false); expect(transition({ consecutiveFailures: 2 }, 'DOWN').openIncident).toBe(true); });
  it("resolves only at the recovery threshold", () => { expect(transition({}, 'UP', true).resolveIncident).toBe(false); expect(transition({ consecutiveSuccesses: 1 }, 'UP', true).resolveIncident).toBe(true); });
  it("resets recovery on another failure", () => { expect(transition({ consecutiveSuccesses: 1 }, 'DOWN', true).consecutiveSuccesses).toBe(0); });
  it("suppresses new incidents during maintenance", () => { const r = transition({ consecutiveFailures: 10 }, 'DOWN', false, true); expect(r.openIncident).toBe(false); expect(r.notify).toBe(false); expect(r.consecutiveFailures).toBe(0); });
  it("allows silent recovery during maintenance", () => { const r = transition({ consecutiveSuccesses: 1 }, 'UP', true, true); expect(r.resolveIncident).toBe(true); expect(r.notify).toBe(false); });
  it("keeps a quiet incident open until 15 stable minutes after flapping", () => {
    const open = transition({ consecutiveFailures: 2 }, 'DOWN', false, false, 4); expect(open.flapping).toBe(true); expect(open.openIncident).toBe(true); expect(open.notify).toBe(false);
    expect(transition({ flapping: true, consecutiveSuccesses: 1 }, 'UP', true).resolveIncident).toBe(false);
    const stable = transition({ flapping: true, consecutiveSuccesses: 14 }, 'UP', true); expect(stable.resolveIncident).toBe(true); expect(stable.flapping).toBe(false);
  });
  it("does not infer elapsed stability from frequent push samples", () => { const r = nextMonitorState({ monitor: { ...monitor, flapping: true, consecutiveSuccesses: 20 }, outcome: "UP", hasOpenIncident: true, inMaintenance: false, recentIncidentCount: 0, stableForSec: 2 }); expect(r.resolveIncident).toBe(false); });
  it("does not count unknown results as recovery", () => { expect(transition({}, 'UNKNOWN', true).consecutiveSuccesses).toBe(0); });
  it("can opt into incidents on degraded outcomes", () => { expect(transition({ consecutiveFailures: 2 }, 'DEGRADED').openIncident).toBe(false); expect(transition({ consecutiveFailures: 2, incidentOnDegraded: true }, 'DEGRADED').openIncident).toBe(true); });
});
describe("monitor statistics and retention summaries", () => {
  it("excludes maintenance and unknown samples from uptime", () => {
    const summary = summarizeChecks([{ status: 'UP', latencyMs: 10, inMaintenance: false }, { status: 'DOWN', latencyMs: 20, inMaintenance: false }, { status: 'DOWN', latencyMs: 30, inMaintenance: true }, { status: 'UNKNOWN', latencyMs: null, inMaintenance: false }], 60);
    expect(uptimePercent(summary)).toBe(50); expect(summary.downtimeSec).toBe(60); expect(summary.latencyP50).toBe(20); expect(summary.latencyP95).toBe(29);
  });
  it("handles empty data and interpolated percentiles", () => { expect(percentileCont([], .95)).toBeNull(); expect(percentileCont([10, 20, 30, 40], .95)).toBeCloseTo(38.5); expect(uptimePercent(summarizeChecks([], 60))).toBeNull(); expect(mergeRollups([]).latencyP95).toBeNull(); expect(dailyBars([], 90, at)).toHaveLength(90); });
});
describe("monitor expiry and schedules", () => {
  it("parses RDAP bootstrap, expiry and registrar vCards", () => {
    const bootstrap = parseRdapBootstrap({ services: [[['com'], ['https://rdap.example.com/']]] }); expect(rdapBaseFor('example.com', bootstrap)).toBe('https://rdap.example.com/');
    expect(rdapExpiration({ events: [{ eventAction: 'expiration', eventDate: '2027-10-19T12:00:00Z' }] })?.getUTCFullYear()).toBe(2027);
    expect(rdapExpiration({ events: [{ eventAction: 'expiration', eventDate: 'invalid' }] })).toBeNull();
    expect(rdapRegistrar({ entities: [{ roles: ['registrar'], vcardArray: ['vcard', [['fn', {}, 'text', 'Example Registrar']]] }] })).toBe('Example Registrar');
  });
  it("detects threshold crossings only once", () => { expect(crossedThreshold(31, 20, 21, 7)).toBe(21); expect(crossedThreshold(20, 19, 21, 7)).toBeNull(); expect(crossedThreshold(8, 6, 21, 7)).toBe(7); expect(daysUntil(new Date(at.getTime() - 1), at)).toBe(-1); expect(expiryStatus(6, 21, 7)).toBe('DOWN'); });
  it("honours cron time zones and grace boundaries", () => {
    const c = heartbeatConfigSchema.parse({ schedule: 'CRON', cronExpr: '0 18 * * *', timezone: 'Asia/Kolkata' }); expect(nextExpectedAt(c, at).toISOString()).toBe('2026-10-19T12:30:00.000Z'); expect(isOverdue(at, 60, new Date(at.getTime() + 60000))).toBe(false); expect(isOverdue(at, 60, new Date(at.getTime() + 60001))).toBe(true); expect(validateCron('broken', 'UTC')).not.toBeNull();
  });
  it.each([['start', null], ['log', null], ['0', 'UP'], ['1', 'DOWN'], ['fail', 'DOWN'], [undefined, 'UP']])('parses heartbeat suffix %s', (suffix, outcome) => { const action = parsePingAction(suffix); expect(action && pingOutcome(action)).toBe(outcome); });
  it("rejects unsupported heartbeat suffixes", () => { expect(parsePingAction('256')).toBeNull(); expect(parsePingAction('success/other')).toBeNull(); });
  it("honours maintenance end boundaries and rejects unsupported recurrence fields", () => { const window = { startsAt: at, endsAt: new Date(at.getTime() + 3600000), rrule: null, durationMin: null, timezone: 'UTC' }; expect(activeOccurrence(window, at)).not.toBeNull(); expect(activeOccurrence(window, window.endsAt)).toBeNull(); expect(parseRrule('FREQ=DAILY;INTERVAL=2')).toBeNull(); });
});
describe("monitor cost aggregation", () => {
  it("never adds balances, forecasts and overlapping daily/monthly totals", () => {
    const base = { connectionId: 'a', currency: 'USD', periodStart: at, periodEnd: new Date(at.getTime() + 86400000), isEstimate: false };
    const rows = [{ ...base, granularity: 'DAY', amount: 2.51 }, { ...base, granularity: 'MTD', amount: 10.25 }, { ...base, granularity: 'BALANCE', amount: 100 }, { ...base, granularity: 'FORECAST', amount: 30 }]; expect(aggregateCosts(rows)[0]).toMatchObject({ spentMinor: 1025, forecastMinor: 3000 });
    expect(aggregateCosts([{ ...base, granularity: 'DAY', amount: 2.51 }, { ...base, currency: 'EUR', granularity: 'DAY', amount: 3 }])).toHaveLength(2);
  });
});
