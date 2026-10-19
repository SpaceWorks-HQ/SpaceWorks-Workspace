import type { NotifySeverity, RuleScopeType } from "@prisma/client";
import type { Severity } from "@/lib/notify/events";
import { deliveryTime, parseQuietHours } from "@/lib/notify/quietHours";
import { SCOPE_KEYS, type NotifyScope } from "@/lib/notify/types";

/**
 * Rule matching (pure). A rule applies to an event when it is enabled, one of
 * its event patterns matches, the event meets its minimum severity, its scope
 * matches (workspace rules apply unless the entity opted out; scoped rules
 * need the event to carry their entity id) and every non-empty filter matches.
 */

const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, critical: 2 };

export const toDbSeverity = (severity: Severity): NotifySeverity => severity.toUpperCase() as NotifySeverity;
export const fromDbSeverity = (severity: NotifySeverity): Severity => severity.toLowerCase() as Severity;

export function meetsSeverity(eventSeverity: Severity, minSeverity: NotifySeverity): boolean {
  return SEVERITY_RANK[eventSeverity] >= SEVERITY_RANK[fromDbSeverity(minSeverity)];
}

/** "monitor.down" exact, "monitor.*" any type under "monitor.", "*" everything. */
export function eventTypeMatches(pattern: string, type: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}

export type RuleFilters = { projectIds?: string[]; monitorIds?: string[]; teamIds?: string[]; tagsAny?: string[] };

export function parseRuleFilters(value: unknown): RuleFilters {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]).filter((v): v is string => typeof v === "string") : undefined);
  return { projectIds: list("projectIds"), monitorIds: list("monitorIds"), teamIds: list("teamIds"), tagsAny: list("tagsAny") };
}

/** The subset of a NotificationRule row that matching needs. */
export type MatchableRule = {
  id: string;
  enabled: boolean;
  scopeType: RuleScopeType;
  scopeId: string | null;
  eventTypes: string[];
  minSeverity: NotifySeverity;
  filters: unknown;
  quietHours: unknown;
  criticalBypassesQuiet: boolean;
  dedupeWindowSec: number;
};

export type MatchableEvent = { type: string; severity: Severity; scope?: NotifyScope; useWorkspaceRules?: boolean };

function filterMatches(allowed: string[] | undefined, actual: string | string[] | undefined) {
  if (!allowed || allowed.length === 0) return true;
  if (actual === undefined) return false;
  const values = Array.isArray(actual) ? actual : [actual];
  return values.some((value) => allowed.includes(value));
}

export function ruleMatchesEvent(rule: MatchableRule, event: MatchableEvent): boolean {
  if (!rule.enabled) return false;
  if (!rule.eventTypes.some((pattern) => eventTypeMatches(pattern, event.type))) return false;
  if (!meetsSeverity(event.severity, rule.minSeverity)) return false;
  const scope = event.scope ?? {};
  if (rule.scopeType === "WORKSPACE") {
    if (event.useWorkspaceRules === false) return false;
  } else {
    const key = SCOPE_KEYS[rule.scopeType];
    if (!rule.scopeId || scope[key] !== rule.scopeId) return false;
  }
  const filters = parseRuleFilters(rule.filters);
  return (
    filterMatches(filters.projectIds, scope.projectId) &&
    filterMatches(filters.monitorIds, scope.monitorId) &&
    filterMatches(filters.teamIds, scope.teamId) &&
    filterMatches(filters.tagsAny, scope.tags)
  );
}

export type BroadcastTarget = { destinationId: string; ruleId: string; scheduledFor: Date; dedupeWindowSec: number };

/**
 * Union the destinations of every matching rule. When several rules reach the
 * same destination, the earliest allowed send time wins (most permissive
 * quiet hours) and the shortest dedupe window applies.
 */
export function selectBroadcastTargets(
  rules: Array<MatchableRule & { destinationIds: string[] }>,
  event: MatchableEvent,
  now: Date,
): BroadcastTarget[] {
  const targets = new Map<string, BroadcastTarget>();
  for (const rule of rules) {
    if (!ruleMatchesEvent(rule, event)) continue;
    const scheduledFor = deliveryTime({ at: now, severity: event.severity, quietHours: parseQuietHours(rule.quietHours), criticalBypasses: rule.criticalBypassesQuiet });
    for (const destinationId of rule.destinationIds) {
      const existing = targets.get(destinationId);
      if (!existing) {
        targets.set(destinationId, { destinationId, ruleId: rule.id, scheduledFor, dedupeWindowSec: rule.dedupeWindowSec });
      } else {
        if (scheduledFor < existing.scheduledFor) Object.assign(existing, { ruleId: rule.id, scheduledFor });
        existing.dedupeWindowSec = Math.min(existing.dedupeWindowSec, rule.dedupeWindowSec);
      }
    }
  }
  return [...targets.values()];
}
