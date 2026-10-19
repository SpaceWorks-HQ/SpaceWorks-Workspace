/**
 * Delivery dedupe (pure). A candidate is dropped when an earlier event with
 * the same `dedupeKey` already reached the same target inside the
 * candidate's window. Targets are "destination:<id>" or
 * "user:<userId>:<channel>".
 */
export type DedupeCandidate = { target: string; windowSec: number };
export type PriorDelivery = { target: string; at: Date };

/** Default window for personal deliveries (no rule involved). */
export const PERSONAL_DEDUPE_WINDOW_SEC = 300;

export function isDuplicate(candidate: DedupeCandidate, prior: PriorDelivery[], now: Date): boolean {
  const since = now.getTime() - candidate.windowSec * 1000;
  return prior.some((delivery) => delivery.target === candidate.target && delivery.at.getTime() >= since);
}

export function partitionDuplicates<T extends DedupeCandidate>(candidates: T[], prior: PriorDelivery[], now: Date): { kept: T[]; dropped: T[] } {
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const candidate of candidates) (isDuplicate(candidate, prior, now) ? dropped : kept).push(candidate);
  return { kept, dropped };
}

export const destinationTarget = (destinationId: string) => `destination:${destinationId}`;
export const personalTarget = (userId: string, channel: string) => `user:${userId}:${channel}`;
