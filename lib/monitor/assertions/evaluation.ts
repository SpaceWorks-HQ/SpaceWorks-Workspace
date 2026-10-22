import type { AssertionResult } from "@/lib/monitor/types";
import type { Assertion, AssertionContext, Literal, Subject } from "./types";
import { parseAssertion } from "./parser";

const MAX_BODY_FOR_REGEX = 100_000;

function readPath(value: unknown, path: Array<string | number>): { found: boolean; value: unknown } {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current) || key >= current.length) return { found: false, value: undefined };
      current = current[key];
    } else {
      if (current === null || typeof current !== "object" || Array.isArray(current) || !Object.prototype.hasOwnProperty.call(current, key)) return { found: false, value: undefined };
      current = (current as Record<string, unknown>)[key];
    }
  }
  return { found: true, value: current };
}

function stringify(value: unknown): string {
  if (value === undefined) return "(missing)";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function literalEquals(actual: unknown, literal: Literal): boolean {
  switch (literal.type) {
    case "null":
      return actual === null;
    case "boolean":
      return actual === literal.value || (typeof actual === "string" && actual === String(literal.value));
    case "number":
      if (typeof actual === "number") return actual === literal.value;
      if (typeof actual === "string" && actual.trim() !== "" && Number.isFinite(Number(actual))) return Number(actual) === literal.value;
      return false;
    case "string":
      return typeof actual === "string" ? actual === literal.value : stringify(actual) === literal.value;
  }
}

function toNumber(actual: unknown): number | null {
  if (typeof actual === "number" && Number.isFinite(actual)) return actual;
  if (typeof actual === "string" && actual.trim() !== "" && Number.isFinite(Number(actual))) return Number(actual);
  return null;
}

function resolveSubject(subject: Subject, context: AssertionContext, jsonCache: { parsed?: { ok: boolean; value: unknown } }): { found: boolean; value: unknown } {
  switch (subject.kind) {
    case "STATUS":
      return { found: context.status !== undefined, value: context.status };
    case "RESPONSE_TIME":
      return { found: context.responseTimeMs !== undefined, value: context.responseTimeMs };
    case "CERTIFICATE_EXPIRATION":
      return { found: context.certExpiresInMs != null, value: context.certExpiresInMs };
    case "DOMAIN_EXPIRATION":
      return { found: context.domainExpiresInMs != null, value: context.domainExpiresInMs };
    case "CONNECTED":
      return { found: context.connected !== undefined, value: context.connected };
    case "IP":
      return { found: context.ip !== undefined, value: context.ip };
    case "HEADER": {
      const entry = Object.entries(context.headers ?? {}).find(([name]) => name.toLowerCase() === subject.name);
      const value = Array.isArray(entry?.[1]) ? entry[1].join(", ") : entry?.[1];
      return { found: value !== undefined, value };
    }
    case "BODY": {
      if (subject.path.length === 0) return { found: context.body !== undefined, value: context.body ?? "" };
      if (!jsonCache.parsed) {
        try {
          jsonCache.parsed = { ok: true, value: JSON.parse(context.body ?? "") };
        } catch {
          jsonCache.parsed = { ok: false, value: undefined };
        }
      }
      if (!jsonCache.parsed.ok) return { found: false, value: undefined };
      return readPath(jsonCache.parsed.value, subject.path);
    }
  }
}

/** Evaluate one parsed assertion. Missing values fail every operator except `!=` / `!contains`. */
export function evaluateAssertion(assertion: Assertion, context: AssertionContext, jsonCache: { parsed?: { ok: boolean; value: unknown } } = {}): AssertionResult {
  const { subject, op, operand } = assertion;
  const resolved = resolveSubject(subject, context, jsonCache);
  const actual = resolved.value;
  const actualText = subject.kind === "BODY" && subject.path.length === 0 ? undefined : stringify(actual).slice(0, 200);
  const result = (passed: boolean): AssertionResult => ({ expr: assertion.expr, passed, ...(actualText !== undefined ? { actual: actualText } : {}) });
  if (!resolved.found) return result(op === "!=" || op === "!contains" || op === "!matches");

  switch (op) {
    case "==":
    case "!=": {
      const equal = operand.type === "any" ? operand.values.some((literal) => literalEquals(actual, literal)) : operand.type === "regex" ? false : literalEquals(actual, operand);
      return result(op === "==" ? equal : !equal);
    }
    case "<":
    case "<=":
    case ">":
    case ">=": {
      const left = toNumber(actual);
      if (left === null || operand.type !== "number") return result(false);
      const right = operand.value;
      return result(op === "<" ? left < right : op === "<=" ? left <= right : op === ">" ? left > right : left >= right);
    }
    case "contains":
    case "!contains": {
      const haystack = typeof actual === "string" ? actual : stringify(actual);
      const needles = operand.type === "any" ? operand.values : operand.type === "regex" ? [] : [operand];
      const contains = needles.some((needle) => haystack.includes(needle.type === "string" ? needle.value : needle.type === "number" || needle.type === "boolean" ? String(needle.value) : "null"));
      return result(op === "contains" ? contains : !contains);
    }
    case "matches":
    case "!matches": {
      if (operand.type !== "regex") return result(false);
      const text = (typeof actual === "string" ? actual : stringify(actual)).slice(0, MAX_BODY_FOR_REGEX);
      const matched = new RegExp(operand.pattern, operand.flags.replace(/[^imsu]/g, "")).test(text);
      return result(op === "matches" ? matched : !matched);
    }
  }
}

/** Parse and evaluate a list of expressions (invalid ones fail with an explanation). */
export function evaluateAssertions(expressions: string[], context: AssertionContext): AssertionResult[] {
  const jsonCache: { parsed?: { ok: boolean; value: unknown } } = {};
  return expressions.map((expr) => {
    const parsed = parseAssertion(expr);
    if (!parsed.ok) return { expr, passed: false, actual: parsed.error };
    return evaluateAssertion(parsed.assertion, context, jsonCache);
  });
}

