/**
 * Task dependency graph rules (pure, client-safe). An edge `blocking → blocked`
 * means "blocking blocks blocked". The graph must stay acyclic: adding
 * A → B is rejected when B already (transitively) blocks A, or A = B.
 */

export type DependencyEdge = { blockingTaskId: string; blockedTaskId: string };

/** Would adding `blocking → blocked` close a cycle? Iterative DFS from `blocked`. */
export function wouldCreateCycle(edges: readonly DependencyEdge[], blockingTaskId: string, blockedTaskId: string): boolean {
  if (blockingTaskId === blockedTaskId) return true;
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const list = outgoing.get(edge.blockingTaskId);
    if (list) list.push(edge.blockedTaskId);
    else outgoing.set(edge.blockingTaskId, [edge.blockedTaskId]);
  }
  const seen = new Set<string>();
  const stack = [blockedTaskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === blockingTaskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of outgoing.get(current) ?? []) if (!seen.has(next)) stack.push(next);
  }
  return false;
}

/** A task is blocked while any of its blockers is still open (not completed, not archived). */
export function isBlocked(blockers: ReadonlyArray<{ completedAt: Date | string | null; archivedAt: Date | string | null }>): boolean {
  return blockers.some((blocker) => !blocker.completedAt && !blocker.archivedAt);
}
