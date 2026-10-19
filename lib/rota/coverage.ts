export const OCCUPIED = ["CONFIRMED", "SWAP_REQUESTED", "ATTENDED"] as const;
export function coverage(capacity: number, assignments: readonly { status: string }[]) {
  const filled = assignments.filter(a => (OCCUPIED as readonly string[]).includes(a.status)).length;
  return { filled, open: Math.max(0, capacity - filled), covered: filled >= capacity };
}
export function hasShiftConflict(shifts: readonly { startsAt: Date; endsAt: Date }[], candidate: { startsAt: Date; endsAt: Date }) {
  return shifts.some(s => s.startsAt < candidate.endsAt && s.endsAt > candidate.startsAt);
}
