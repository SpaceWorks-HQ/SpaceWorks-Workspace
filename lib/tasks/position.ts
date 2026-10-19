/**
 * Fractional ordering for board cards and columns (pure, client-safe).
 *
 * Items carry a float `position`; moving an item writes one new value
 * halfway between its new neighbours. When two neighbours get too close
 * (after many moves into the same gap) the whole list is renumbered with
 * even gaps, which the caller does inside the same transaction.
 */

export const POSITION_GAP = 1024;
/** Below this gap the halfway point loses precision: renumber instead. */
export const MIN_POSITION_GAP = 1e-6;

/** A position strictly between `before` and `after` (either may be missing). */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  const hasBefore = typeof before === "number" && Number.isFinite(before);
  const hasAfter = typeof after === "number" && Number.isFinite(after);
  if (!hasBefore && !hasAfter) return POSITION_GAP;
  if (!hasBefore) return (after as number) - POSITION_GAP;
  if (!hasAfter) return (before as number) + POSITION_GAP;
  return ((before as number) + (after as number)) / 2;
}

/** True when there is no usable room between two neighbours. */
export function needsRebalance(before: number | null | undefined, after: number | null | undefined): boolean {
  if (typeof before !== "number" || typeof after !== "number") return false;
  return after - before < MIN_POSITION_GAP * 2;
}

/** Evenly spaced positions for `count` items, in order. */
export function evenPositions(count: number): number[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => (index + 1) * POSITION_GAP);
}

export type Placement = {
  /** The moving item's new position. */
  position: number;
  /**
   * When set, renumber the list first: `ordered` positions are replaced by
   * these values (same order, moving item excluded), and `position` is
   * already computed against them.
   */
  rebalanced: number[] | null;
};

/**
 * Where to put an item so it lands at `index` of `ordered` (the other
 * items' positions in display order, the moving item excluded). `index`
 * is clamped to the list.
 */
export function placeAt(ordered: readonly number[], index: number): Placement {
  const at = Math.min(Math.max(0, Math.trunc(index)), ordered.length);
  const before = at > 0 ? ordered[at - 1] : null;
  const after = at < ordered.length ? ordered[at] : null;
  if (!needsRebalance(before, after)) return { position: positionBetween(before, after), rebalanced: null };
  const rebalanced = evenPositions(ordered.length);
  return {
    position: positionBetween(at > 0 ? rebalanced[at - 1] : null, at < rebalanced.length ? rebalanced[at] : null),
    rebalanced,
  };
}

/** Stable display order: position, then a tie-breaker (task number or creation order). */
export function compareByPosition<T extends { position: number; tieBreaker?: number | string }>(a: T, b: T): number {
  if (a.position !== b.position) return a.position - b.position;
  const x = a.tieBreaker ?? 0;
  const y = b.tieBreaker ?? 0;
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Move an id inside an ordered id list (client optimistic update). The item
 * is removed from wherever it is and inserted directly below `afterId`
 * (null = at the top; an unknown `afterId` appends it at the end).
 */
export function moveId(ids: readonly string[], id: string, afterId: string | null): string[] {
  const rest = ids.filter((value) => value !== id);
  if (afterId === null) return [id, ...rest];
  const index = rest.indexOf(afterId);
  if (index === -1) return [...rest, id];
  return [...rest.slice(0, index + 1), id, ...rest.slice(index + 1)];
}
