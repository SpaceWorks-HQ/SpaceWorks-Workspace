/** Pure parsers shared by the editor, preview and tests. Values never enter error messages. */
export class SecretsError extends Error {}
export const KEY_PATTERN = /^[A-Z_][A-Z0-9_]{0,127}$/;
export const ROLES = ["NONE", "KEYS", "READ", "WRITE", "ADMIN"] as const;
export type SecretRole = (typeof ROLES)[number];
export function normalisePath(path: string) {
  if (
    !/^\/(?:[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*)?$/.test(path) ||
    path.length > 200
  )
    throw new SecretsError("Use a folder path such as /api.");
  return path;
}
export function parseDotenv(source: string): Record<string, string> {
  if (source.length > 200000 || source.includes("\0"))
    throw new SecretsError(
      "Use an environment file under 200 KB without null characters.",
    );
  const out: Record<string, string> = Object.create(null);
  const text = source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  let at = 0;
  while (at < text.length) {
    while (/[ \t\n]/.test(text[at] ?? "\0")) at++;
    if (at >= text.length) break;
    if (text[at] === "#") {
      while (at < text.length && text[at] !== "\n") at++;
      continue;
    }
    const match = /^(?:export[ \t]+)?([A-Z_][A-Z0-9_]*)[ \t]*=[ \t]*/.exec(
      text.slice(at),
    );
    if (!match || !KEY_PATTERN.test(match[1]))
      throw new SecretsError("Check the key names and KEY=value syntax.");
    const key = match[1];
    at += match[0].length;
    let value = "";
    const quote = text[at];
    if (quote === '"' || quote === "'") {
      at++;
      let closed = false;
      while (at < text.length) {
        const ch = text[at++];
        if (ch === quote) {
          closed = true;
          break;
        }
        if (ch === "\\" && quote === '"') {
          const next = text[at++];
          if (next === undefined) break;
          value +=
            next === "n"
              ? "\n"
              : next === "r"
                ? "\r"
                : next === "t"
                  ? "\t"
                  : next === '"' || next === "\\"
                    ? next
                    : "\\" + next;
        } else value += ch;
      }
      if (!closed)
        throw new SecretsError("Close each quoted value before importing.");
      while (text[at] === " " || text[at] === "\t") at++;
      if (at < text.length && text[at] !== "\n" && text[at] !== "#")
        throw new SecretsError(
          "Put comments after a space or on their own line.",
        );
      while (at < text.length && text[at] !== "\n") at++;
    } else {
      const start = at;
      while (at < text.length && text[at] !== "\n" && text[at] !== "#") at++;
      value = text.slice(start, at).trimEnd();
      while (at < text.length && text[at] !== "\n") at++;
    }
    if (Object.hasOwn(out, key))
      throw new SecretsError("Each key may appear only once in an import.");
    if (value.length > 20000)
      throw new SecretsError("Keep each value under 20,000 characters.");
    out[key] = value;
    if (Object.keys(out).length > 500)
      throw new SecretsError("Import up to 500 keys at a time.");
  }
  return out;
}
export function formatSecrets(values: Record<string, string>, format: string) {
  const entries = Object.entries(values).sort(([a], [b]) => a.localeCompare(b));
  if (format === "json")
    return JSON.stringify(Object.fromEntries(entries), null, 2) + "\n";
  if (format === "yaml")
    return (
      entries
        .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
        .join("\n") + "\n"
    );
  if (format !== "env") throw new SecretsError("Choose env, json or yaml.");
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join("\n") + "\n";
}
export type ReferenceLocation = {
  environment: string;
  path: string;
  key: string;
};
/** Scope this resolver to one authorised read; never share plaintext across requests. */
export function createValueResolver(
  load: (location: ReferenceLocation) => Promise<string>,
) {
  const resolved = new Map<string, { value: string; depth: number }>();
  let visits = 0, characters = 0;
  const exhausted = () => new SecretsError(
    "Secret reference expansion is too large. Use fewer or smaller references.",
  );
  async function resolve(location: ReferenceLocation, stack: string[] = []) {
    if (++visits > 10000) throw exhausted();
    const identity = `${location.environment}:${location.path}:${location.key}`;
    if (stack.includes(identity))
      throw new SecretsError(
        "Secret references contain a cycle. Check the referenced keys.",
      );
    const cached = resolved.get(identity);
    if (stack.length + (cached?.depth ?? 1) > 32)
      throw new SecretsError(
        "Secret references are too deep. Use fewer than 32 levels.",
      );
    if (cached) return cached;
    const value = await load(location);
    let out = "", end = 0, depth = 1;
    function append(text: string) {
      if (out.length + text.length > 200000)
        throw new SecretsError("The resolved value is too large.");
      characters += text.length;
      if (characters > 1000000) throw exhausted();
      out += text;
    }
    for (const match of value.matchAll(/\$\{([^}]+)\}/g)) {
      const parts = match[1].split(".");
      const key = parts.pop()!;
      if (
        !KEY_PATTERN.test(key) ||
        parts.some((p) => !/^[a-zA-Z0-9_-]+$/.test(p))
      )
        throw new SecretsError("A secret reference has an invalid name.");
      const target = parts.length
        ? {
            environment: parts[0],
            path: parts.length > 1 ? "/" + parts.slice(1).join("/") : "/",
            key,
          }
        : { ...location, key };
      append(value.slice(end, match.index));
      const child = await resolve(target, [...stack, identity]);
      append(child.value);
      depth = Math.max(depth, child.depth + 1);
      end = match.index! + match[0].length;
    }
    append(value.slice(end));
    const result = { value: out, depth };
    resolved.set(identity, result);
    return result;
  }
  return async (location: ReferenceLocation): Promise<string> => (await resolve(location)).value;
}
export async function resolveValue(
  location: ReferenceLocation,
  load: (location: ReferenceLocation) => Promise<string>,
): Promise<string> {
  return createValueResolver(load)(location);
}
export function metadataDiff(
  before: {
    path: string;
    key: string;
    fingerprint: string;
  }[],
  after: {
    path: string;
    key: string;
    fingerprint: string;
  }[],
) {
  const old = new Map(before.map((r) => [r.path + ":" + r.key, r]));
  const next = new Map(after.map((r) => [r.path + ":" + r.key, r]));
  return [...new Set([...old.keys(), ...next.keys()])]
    .sort()
    .map((id) => ({
      path: (next.get(id) ?? old.get(id))!.path,
      key: (next.get(id) ?? old.get(id))!.key,
      operation: !old.has(id)
        ? "add"
        : !next.has(id)
          ? "delete"
          : old.get(id)!.fingerprint === next.get(id)!.fingerprint
            ? "unchanged"
            : "update",
    }));
}
