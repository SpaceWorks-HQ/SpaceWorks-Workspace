/**
 * Comment mentions (pure, client-safe). Comments are plain text; a mention
 * is stored as the token `<@userId>` and rendered with the member's
 * current name, so renaming someone never breaks old comments.
 */

const TOKEN = /<@([A-Za-z0-9_-]{1,64})>/g;

export function extractMentionIds(body: string): string[] {
  return [...new Set([...body.matchAll(TOKEN)].map((match) => match[1]!))];
}

export type CommentSegment = { type: "text"; text: string } | { type: "mention"; userId: string };

export function splitMentions(body: string): CommentSegment[] {
  const segments: CommentSegment[] = [];
  let last = 0;
  for (const match of body.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: "text", text: body.slice(last, index) });
    segments.push({ type: "mention", userId: match[1]! });
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ type: "text", text: body.slice(last) });
  return segments;
}

/**
 * Composer → stored body: every `@Name` the author picked from the mention
 * menu becomes `<@id>`. Longer names are replaced first so "@Ann Marie"
 * wins over "@Ann".
 */
export function encodeMentions(text: string, picked: ReadonlyArray<{ id: string; name: string }>): string {
  let result = text;
  const sorted = [...picked].filter((person) => person.name.trim()).sort((a, b) => b.name.length - a.name.length);
  for (const person of sorted) {
    const escaped = person.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(`@${escaped}(?![\\w])`, "g"), `<@${person.id}>`);
  }
  return result;
}

/** Stored body → composer text, for editing a comment. */
export function decodeMentions(body: string, nameOf: (userId: string) => string): { text: string; picked: Array<{ id: string; name: string }> } {
  const picked = new Map<string, string>();
  const text = body.replace(TOKEN, (_, id: string) => {
    const name = nameOf(id);
    picked.set(id, name);
    return `@${name}`;
  });
  return { text, picked: [...picked].map(([id, name]) => ({ id, name })) };
}
