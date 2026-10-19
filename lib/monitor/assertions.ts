import type { AssertionResult } from "@/lib/monitor/types";

/**
 * Condition expressions for HTTP monitors, parsed by a small safe parser
 * (never `eval`). Pure and client-safe so the form can validate as you type.
 *
 *   [STATUS] == 200            [STATUS] == any(200, 204)     [STATUS] < 400
 *   [RESPONSE_TIME] < 800      [BODY] contains "ok"           [BODY] !contains "error"
 *   [BODY] matches /up|ok/i    [BODY].data.status == "healthy" [BODY].items[0].id == any(1, 2)
 *   [HEADER].content-type contains "json"                     [CERTIFICATE_EXPIRATION] > 14d
 *   [DOMAIN_EXPIRATION] > 720h [CONNECTED] == true            [IP] == 203.0.113.10
 */

export type Subject =
  | { kind: "STATUS" }
  | { kind: "RESPONSE_TIME" }
  | { kind: "BODY"; path: Array<string | number> }
  | { kind: "HEADER"; name: string }
  | { kind: "CERTIFICATE_EXPIRATION" }
  | { kind: "DOMAIN_EXPIRATION" }
  | { kind: "CONNECTED" }
  | { kind: "IP" };

export type Operator = "==" | "!=" | "<" | "<=" | ">" | ">=" | "contains" | "!contains" | "matches" | "!matches";

type Literal = { type: "number"; value: number } | { type: "string"; value: string } | { type: "boolean"; value: boolean } | { type: "null" };
export type Operand = Literal | { type: "any"; values: Literal[] } | { type: "regex"; pattern: string; flags: string };

export type Assertion = { expr: string; subject: Subject; op: Operator; operand: Operand };

export type AssertionContext = {
  status?: number;
  responseTimeMs?: number;
  body?: string;
  headers?: Record<string, string | string[] | undefined>;
  certExpiresInMs?: number | null;
  domainExpiresInMs?: number | null;
  connected?: boolean;
  ip?: string;
};

const SUBJECT_RE = /^\[(STATUS|RESPONSE_TIME|BODY|HEADER|CERTIFICATE_EXPIRATION|DOMAIN_EXPIRATION|CONNECTED|IP)\]/i;
const OPERATORS: Operator[] = ["!contains", "contains", "!matches", "matches", "==", "!=", "<=", ">=", "<", ">"];
const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;
const DURATION_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const MAX_BODY_FOR_REGEX = 100_000;

export type ParseResult = { ok: true; assertion: Assertion } | { ok: false; error: string };

function parsePath(raw: string): Array<string | number> | null {
  const path: Array<string | number> = [];
  let rest = raw;
  while (rest.length > 0) {
    const key = rest.match(/^\.([A-Za-z0-9_$-]+)/);
    if (key) {
      path.push(key[1]);
      rest = rest.slice(key[0].length);
      continue;
    }
    const index = rest.match(/^\[(\d{1,6})\]/);
    if (index) {
      path.push(Number(index[1]));
      rest = rest.slice(index[0].length);
      continue;
    }
    return null;
  }
  return path.length > 16 ? null : path;
}

function parseLiteral(raw: string): Literal | null {
  const value = raw.trim();
  if (!value) return null;
  if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
    return { type: "string", value: value.slice(1, -1).replace(/\\(["'\\])/g, "$1") };
  }
  if (value === "true" || value === "false") return { type: "boolean", value: value === "true" };
  if (value === "null") return { type: "null" };
  const duration = value.match(DURATION_RE);
  if (duration) return { type: "number", value: Number(duration[1]) * DURATION_MS[duration[2]] };
  if (/^-?\d+(\.\d+)?$/.test(value)) return { type: "number", value: Number(value) };
  if (/^[^\s,()]+$/.test(value)) return { type: "string", value };
  return null;
}

function splitArgs(raw: string): string[] | null {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (quote) {
      current += ch;
      if (ch === "\\" && i + 1 < raw.length) {
        current += raw[i + 1];
        i += 1;
      } else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  if (quote) return null;
  parts.push(current);
  return parts;
}

/** Reject patterns that are long or have nested quantifiers / back-references (catastrophic backtracking). */
export function isSafeRegex(pattern: string): boolean {
  if (pattern.length === 0 || pattern.length > 200) return false;
  // Restrict expressions to a linear subset; arbitrary JS patterns can block the checker.
  if (/[(){}]/.test(pattern) || /\\[1-9]/.test(pattern)) return false;
  const repeats = pattern.match(/(?<!\\)[*+?]/g) ?? [];
  if (repeats.length > 1 || (repeats.length && (!pattern.startsWith("^") || pattern.includes("|")))) return false;
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function parseOperand(raw: string, op: Operator): Operand | null {
  const value = raw.trim();
  if (op === "matches" || op === "!matches") {
    const regex = value.match(/^\/(.+)\/([imsu]*)$/);
    const pattern = regex ? regex[1] : value.replace(/^"(.*)"$/, "$1");
    const flags = regex ? regex[2] : "";
    if (!isSafeRegex(pattern)) return null;
    try { new RegExp(pattern, flags); } catch { return null; }
    return { type: "regex", pattern, flags };
  }
  const any = value.match(/^any\((.*)\)$/i);
  if (any) {
    const parts = splitArgs(any[1]);
    if (!parts || parts.length === 0 || parts.length > 20) return null;
    const values = parts.map(parseLiteral);
    if (values.some((entry) => entry === null)) return null;
    return { type: "any", values: values as Literal[] };
  }
  return parseLiteral(value);
}

export function parseAssertion(input: string): ParseResult {
  const expr = input.trim();
  if (!expr) return { ok: false, error: "Write a condition such as [STATUS] == 200." };
  if (expr.length > 500) return { ok: false, error: "Keep conditions under 500 characters." };
  const subjectMatch = expr.match(SUBJECT_RE);
  if (!subjectMatch) return { ok: false, error: "Start with [STATUS], [RESPONSE_TIME], [BODY], [HEADER].name, [CERTIFICATE_EXPIRATION], [DOMAIN_EXPIRATION], [CONNECTED] or [IP]." };
  const kind = subjectMatch[1].toUpperCase() as Subject["kind"];
  let rest = expr.slice(subjectMatch[0].length);
  let subject: Subject;
  if (kind === "BODY") {
    const pathRaw = rest.match(/^((?:\.[A-Za-z0-9_$-]+|\[\d{1,6}\])*)/)?.[1] ?? "";
    const path = parsePath(pathRaw);
    if (path === null) return { ok: false, error: "Use a JSON path like [BODY].data.items[0].status." };
    subject = { kind: "BODY", path };
    rest = rest.slice(pathRaw.length);
  } else if (kind === "HEADER") {
    const name = rest.match(/^\.([A-Za-z0-9-]{1,100})/);
    if (!name) return { ok: false, error: "Name the header, like [HEADER].content-type." };
    subject = { kind: "HEADER", name: name[1].toLowerCase() };
    rest = rest.slice(name[0].length);
  } else subject = { kind } as Subject;

  rest = rest.trimStart();
  const op = OPERATORS.find((candidate) => rest.startsWith(candidate) && (/^[!<>=]/.test(candidate) || /\s/.test(rest[candidate.length] ?? "")));
  if (!op) return { ok: false, error: "Use an operator: ==, !=, <, <=, >, >=, contains, !contains, matches." };
  const operand = parseOperand(rest.slice(op.length), op);
  if (!operand) {
    return {
      ok: false,
      error: op.endsWith("matches") ? "Use a short regular expression like /ok|up/i (no nested repeats)." : "Compare with a number, a duration (14d), \"text\", true/false or any(a, b).",
    };
  }
  if ((op === "<" || op === "<=" || op === ">" || op === ">=") && operand.type !== "number") {
    return { ok: false, error: "Compare sizes with a number or a duration like 500 or 14d." };
  }
  return { ok: true, assertion: { expr, subject, op, operand } };
}

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

/** "200-299, 301" → predicate. Invalid input falls back to 200–399. */
export function parseExpectedStatus(spec: string | undefined): (status: number) => boolean {
  const ranges: Array<[number, number]> = [];
  for (const part of (spec ?? "").split(",")) {
    const match = part.trim().match(/^(\d{3})(?:\s*-\s*(\d{3}))?$/);
    if (!match) continue;
    const low = Number(match[1]);
    const high = match[2] ? Number(match[2]) : low;
    ranges.push([Math.min(low, high), Math.max(low, high)]);
  }
  if (ranges.length === 0) ranges.push([200, 399]);
  return (status) => ranges.some(([low, high]) => status >= low && status <= high);
}
