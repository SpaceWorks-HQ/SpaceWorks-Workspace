/**
 * Message reactions (pure). Reactions are message content, so emoji are fine
 * here; the set is curated to keep the picker calm and the data predictable.
 */

export const REACTIONS = [
  { emoji: "👍", label: "Thumbs up" },
  { emoji: "❤️", label: "Heart" },
  { emoji: "🎉", label: "Celebrate" },
  { emoji: "😂", label: "Laughing" },
  { emoji: "👀", label: "Looking" },
  { emoji: "🙏", label: "Thanks" },
  { emoji: "✅", label: "Done" },
  { emoji: "🔥", label: "Fire" },
] as const;

export type ReactionEmoji = (typeof REACTIONS)[number]["emoji"];

const ORDER = new Map<string, number>(REACTIONS.map((r, i) => [r.emoji, i]));

export function isAllowedReaction(value: unknown): value is ReactionEmoji {
  return typeof value === "string" && ORDER.has(value);
}

export function reactionLabel(emoji: string): string {
  return REACTIONS.find((r) => r.emoji === emoji)?.label ?? "Reaction";
}

export type ReactionSummary = { emoji: string; label: string; count: number; mine: boolean; names: string[] };

/** Group reaction rows into counts (curated order), marking the viewer's own. */
export function summarizeReactions(rows: Array<{ emoji: string; userId: string }>, viewerId: string, names: Record<string, string> = {}): ReactionSummary[] {
  const groups = new Map<string, ReactionSummary>();
  for (const row of rows) {
    if (!ORDER.has(row.emoji)) continue;
    const group = groups.get(row.emoji) ?? { emoji: row.emoji, label: reactionLabel(row.emoji), count: 0, mine: false, names: [] };
    group.count += 1;
    if (row.userId === viewerId) group.mine = true;
    if (group.names.length < 10) group.names.push(row.userId === viewerId ? "You" : names[row.userId] ?? "Former member");
    groups.set(row.emoji, group);
  }
  return [...groups.values()].sort((a, b) => ORDER.get(a.emoji)! - ORDER.get(b.emoji)!);
}
