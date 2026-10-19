import { EVENT_CATALOG, EVENT_TYPES, isEventType, type EventType } from "@/lib/notify/events";
import { eventTypeMatches } from "@/lib/notify/match";

/**
 * Event-type patterns for workspace rules (pure and client-safe). A rule
 * lists exact catalogue types, "<prefix>.*" wildcards for any prefix that
 * exists in the catalogue ("monitor.*", "github.*", "finance.approval.*"),
 * or "*" for everything.
 */

/** Every dotted prefix that at least one catalogue type sits under, sorted. */
export const EVENT_PREFIXES: readonly string[] = [
  ...new Set(
    EVENT_TYPES.flatMap((type) => {
      const segments = type.split(".");
      return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("."));
    }),
  ),
].sort();

const PREFIX_SET = new Set(EVENT_PREFIXES);

export const MAX_RULE_PATTERNS = 50;

export function isValidEventPattern(pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) return PREFIX_SET.has(pattern.slice(0, -2));
  return isEventType(pattern);
}

/** Catalogue types a set of patterns reaches, in catalogue order. */
export function expandEventPatterns(patterns: readonly string[]): EventType[] {
  return EVENT_TYPES.filter((type) => patterns.some((pattern) => eventTypeMatches(pattern, type)));
}

/** Does `broader` cover every type `narrower` covers (and is not the same pattern)? */
function covers(broader: string, narrower: string): boolean {
  if (broader === narrower) return false;
  if (broader === "*") return true;
  if (!broader.endsWith(".*")) return false;
  const prefix = broader.slice(0, -1);
  return narrower.startsWith(prefix);
}

/**
 * Trim, dedupe and validate patterns, dropping any already covered by a
 * broader pattern in the same list ("monitor.down" next to "monitor.*").
 */
export function normalizeEventPatterns(patterns: readonly string[]): { ok: true; patterns: string[] } | { ok: false; error: string; invalid: string[] } {
  const unique = [...new Set(patterns.map((pattern) => pattern.trim()).filter(Boolean))];
  if (unique.length === 0) return { ok: false, error: "Pick at least one event type.", invalid: [] };
  const invalid = unique.filter((pattern) => !isValidEventPattern(pattern));
  if (invalid.length > 0) {
    const shown = invalid.slice(0, 3).join(", ");
    return { ok: false, error: `Unknown event types: ${shown}${invalid.length > 3 ? "…" : ""}. Pick from the list.`, invalid };
  }
  const kept = unique.filter((pattern) => !unique.some((other) => covers(other, pattern)));
  if (kept.length > MAX_RULE_PATTERNS) return { ok: false, error: `Pick at most ${MAX_RULE_PATTERNS} event types, or use a wildcard.`, invalid: [] };
  return { ok: true, patterns: kept };
}

/** "All events", "All monitor events", or the catalogue label. */
export function eventPatternLabel(pattern: string): string {
  if (pattern === "*") return "All events";
  if (pattern.endsWith(".*")) return `All ${pattern.slice(0, -2)} events`;
  return isEventType(pattern) ? EVENT_CATALOG[pattern].label : pattern;
}

/** Wildcard choices for the rule editor, with how many types each reaches. */
export function wildcardOptions(): Array<{ pattern: string; label: string; count: number }> {
  return ["*", ...EVENT_PREFIXES.map((prefix) => `${prefix}.*`)].map((pattern) => ({
    pattern,
    label: eventPatternLabel(pattern),
    count: expandEventPatterns([pattern]).length,
  }));
}

/**
 * Event-type filter for the delivery log: an exact type or a wildcard, as a
 * Prisma-friendly condition. Null when the pattern is not valid.
 */
export function eventTypeCondition(pattern: string): { equals: string } | { startsWith: string } | null {
  if (!pattern || pattern === "*" || !isValidEventPattern(pattern)) return null;
  return pattern.endsWith(".*") ? { startsWith: pattern.slice(0, -1) } : { equals: pattern };
}
