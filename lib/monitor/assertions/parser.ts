import type { Literal, Operand, Operator, ParseResult, Subject } from "./types";

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

const SUBJECT_RE = /^\[(STATUS|RESPONSE_TIME|BODY|HEADER|CERTIFICATE_EXPIRATION|DOMAIN_EXPIRATION|CONNECTED|IP)\]/i;
const OPERATORS: Operator[] = ["!contains", "contains", "!matches", "matches", "==", "!=", "<=", ">=", "<", ">"];
const DURATION_RE = /^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/;
const DURATION_MS: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

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
