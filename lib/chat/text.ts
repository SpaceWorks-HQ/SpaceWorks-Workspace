/**
 * Message text helpers shared by the server and the composer (pure, client-safe).
 *
 * Stored message bodies are plain text with a small markdown subset and three
 * kinds of tokens:
 *   - `<@userId>`   a member mention (rendered as "@Name")
 *   - `<#channelId>` a channel link (rendered as "#name" for people who can see it)
 *   - `<!channel>` / `<!here>` a broadcast to the channel
 * Tokens keep names out of the stored text, so renames never break old
 * messages and the server can check who was mentioned without parsing names.
 */

export const MAX_MESSAGE_LENGTH = 4000;

const ID = "[A-Za-z0-9_-]{1,64}";
export const USER_TOKEN = new RegExp(`<@(${ID})>`, "g");
export const CHANNEL_TOKEN = new RegExp(`<#(${ID})>`, "g");
export const BROADCAST_TOKEN = /<!(channel|here)>/g;

/**
 * Normalise what a member typed: strip control characters (keeping newlines
 * and tabs), unify line endings, trim trailing spaces, collapse runs of blank
 * lines and trim the whole message.
 */
export function normalizeBody(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200d\u2028\u2029\ufeff]/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

/**
 * Apply `fn` to the parts of `text` that are not code (fenced blocks or
 * inline spans), so tokens and links are never rewritten inside code.
 */
export function mapOutsideCode(text: string, fn: (segment: string) => string): string {
  const fences = text.split("```");
  // An unclosed fence is plain text.
  const closed = fences.length % 2 === 1;
  return fences
    .map((part, index) => {
      const isCode = index % 2 === 1 && (closed || index < fences.length - 1);
      if (isCode) return part;
      return part
        .split(/(`[^`\n]+`)/)
        .map((piece) => (piece.startsWith("`") && piece.endsWith("`") && piece.length > 1 ? piece : fn(piece)))
        .join("");
    })
    .join("```");
}

/** Unique user ids mentioned with `<@id>` (outside code). */
export function extractUserMentions(body: string): string[] {
  const ids = new Set<string>();
  mapOutsideCode(body, (segment) => {
    for (const match of segment.matchAll(USER_TOKEN)) ids.add(match[1]!);
    return segment;
  });
  return [...ids];
}

/** Unique channel ids linked with `<#id>` (outside code). */
export function extractChannelLinks(body: string): string[] {
  const ids = new Set<string>();
  mapOutsideCode(body, (segment) => {
    for (const match of segment.matchAll(CHANNEL_TOKEN)) ids.add(match[1]!);
    return segment;
  });
  return [...ids];
}

/** Does the message notify the whole channel (`<!channel>` or `<!here>`)? */
export function hasBroadcastMention(body: string): boolean {
  let found = false;
  mapOutsideCode(body, (segment) => {
    if (/<!(channel|here)>/.test(segment)) found = true;
    return segment;
  });
  return found;
}

export type MentionCandidate = { id: string; name: string };

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Composer → stored body: replace `@Name` for the members picked from the
 * autocomplete with `<@id>`, and `@channel` / `@here` / `@everyone` with
 * broadcast tokens. Longer names win ("@Meera Nair" before "@Meera").
 */
export function encodeMentions(text: string, picked: MentionCandidate[]): string {
  const unique = [...new Map(picked.filter((p) => p.name.trim()).map((p) => [p.id, p])).values()].sort((a, b) => b.name.length - a.name.length);
  return mapOutsideCode(text, (segment) => {
    let out = segment;
    for (const person of unique) {
      out = out.replace(new RegExp(`(^|[^\\w@<])@${escapeRegExp(person.name)}(?![\\w])`, "g"), (_m, lead: string) => `${lead}<@${person.id}>`);
    }
    return out.replace(/(^|[^\w@<])@(channel|here|everyone)\b/g, (_m, lead: string, word: string) => `${lead}<!${word === "here" ? "here" : "channel"}>`);
  });
}

/**
 * Stored body → composer text (for editing): tokens back to `@Name`,
 * `#channel-name`, `@channel` / `@here`. Returns the members to re-encode.
 */
export function decodeForEditing(
  body: string,
  users: Record<string, string>,
  channels: Record<string, string>,
): { text: string; mentions: MentionCandidate[] } {
  const mentions = new Map<string, MentionCandidate>();
  const text = mapOutsideCode(body, (segment) =>
    segment
      .replace(USER_TOKEN, (_m, id: string) => {
        const name = users[id];
        if (!name) return "@unknown";
        mentions.set(id, { id, name });
        return `@${name}`;
      })
      .replace(CHANNEL_TOKEN, (_m, id: string) => (channels[id] ? `#${channels[id]}` : "#unknown-channel"))
      .replace(BROADCAST_TOKEN, (_m, word: string) => `@${word}`),
  );
  return { text, mentions: [...mentions.values()] };
}

/**
 * Server-side token check before storing: unknown member ids become plain
 * "@unknown", broadcasts become plain text when the author may not use them,
 * and `#slug` becomes `<#id>` for channels the author can see.
 */
export function sanitizeTokens(
  body: string,
  options: { memberIds: ReadonlySet<string>; allowBroadcast: boolean; channelSlugs?: ReadonlyMap<string, string>; channelIds?: ReadonlySet<string> },
): string {
  return mapOutsideCode(body, (segment) => {
    let out = segment
      .replace(USER_TOKEN, (match, id: string) => (options.memberIds.has(id) ? match : "@unknown"))
      .replace(CHANNEL_TOKEN, (match, id: string) => (options.channelIds?.has(id) ? match : "#unknown-channel"))
      .replace(BROADCAST_TOKEN, (match, word: string) => (options.allowBroadcast ? match : `@${word}`));
    if (options.channelSlugs && options.channelSlugs.size > 0) {
      out = out.replace(/(^|[\s(])#([a-z0-9][a-z0-9_-]{0,79})(?![\w-])/g, (match, lead: string, slug: string) => {
        const id = options.channelSlugs!.get(slug);
        return id ? `${lead}<#${id}>` : match;
      });
    }
    return out;
  });
}

/** Task references such as `BOT-12` (project key + task number), outside code. */
export const TASK_REF = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g;

export function extractTaskRefs(body: string): Array<{ key: string; number: number }> {
  const refs = new Map<string, { key: string; number: number }>();
  mapOutsideCode(body, (segment) => {
    // Skip URLs, where "ABC-12" is usually part of a path.
    const withoutUrls = segment.replace(/https?:\/\/\S+/g, " ");
    for (const match of withoutUrls.matchAll(TASK_REF)) refs.set(`${match[1]}-${match[2]}`, { key: match[1]!, number: Number(match[2]) });
    return segment;
  });
  return [...refs.values()].slice(0, 50);
}

/** One-line plain text for notifications, search snippets and previews. */
export function toPlainText(body: string, users: Record<string, string> = {}, channels: Record<string, string> = {}): string {
  return body
    .replace(USER_TOKEN, (_m, id: string) => `@${users[id] ?? "someone"}`)
    .replace(CHANNEL_TOKEN, (_m, id: string) => `#${channels[id] ?? "channel"}`)
    .replace(BROADCAST_TOKEN, (_m, word: string) => `@${word}`)
    .replace(/```[a-z0-9+#-]*\n?/gi, "")
    .replace(/\[([^\]\n]+)\]\((\S+?)\)/g, "$1")
    .replace(/(\*\*|~~|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Shorten to `max` characters on a word boundary with an ellipsis. */
export function preview(text: string, max = 140): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Autocomplete trigger at the caret: `@que` or `#que` preceded by start or
 * whitespace. Returns the query and where the trigger starts, or null.
 */
export function triggerAt(text: string, caret: number): { trigger: "@" | "#"; query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)([@#])([^\s@#]{0,40}(?: [^\s@#]{0,40})?)$/.exec(before);
  if (!match) return null;
  const query = match[3]!;
  // "@Meera N" keeps matching a two-word name; stop after a second space.
  if (match[2] === "#" && query.includes(" ")) return null;
  return { trigger: match[2] as "@" | "#", query, start: before.length - query.length - 1 };
}
