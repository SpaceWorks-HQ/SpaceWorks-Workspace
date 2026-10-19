/**
 * Pure doc-tree helpers (client-safe, unit-tested). Docs form a forest
 * through `parentId`; siblings are ordered by `position` (then title).
 */

export type TreeDoc = { id: string; parentId: string | null; title: string; position: number };
export type TreeNode<T extends TreeDoc> = T & { children: TreeNode<T>[] };

function compareSiblings(a: TreeDoc, b: TreeDoc) {
  return a.position - b.position || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

/**
 * Build a sorted forest. A doc whose parent is not in the list (archived,
 * hidden from this viewer) becomes a root, so nothing silently disappears.
 */
export function buildDocTree<T extends TreeDoc>(docs: T[]): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>(docs.map((doc) => [doc.id, { ...doc, children: [] }]));
  const roots: TreeNode<T>[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: TreeNode<T>[]) => {
    list.sort(compareSiblings);
    for (const item of list) sort(item.children);
  };
  sort(roots);
  return roots;
}

/** Ids of every descendant of `rootId` (not including it). Safe on cyclic data. */
export function descendantIds(docs: Pick<TreeDoc, "id" | "parentId">[], rootId: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const doc of docs) {
    if (!doc.parentId) continue;
    const list = children.get(doc.parentId) ?? [];
    list.push(doc.id);
    children.set(doc.parentId, list);
  }
  const found = new Set<string>();
  const stack = [...(children.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (found.has(id) || id === rootId) continue;
    found.add(id);
    stack.push(...(children.get(id) ?? []));
  }
  return found;
}

/** Ancestor ids from the root down to the direct parent. Stops on cycles. */
export function ancestorIds(docs: Pick<TreeDoc, "id" | "parentId">[], id: string): string[] {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const chain: string[] = [];
  const seen = new Set<string>([id]);
  let current = byId.get(id)?.parentId ?? null;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.unshift(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return chain;
}

export type MoveCheck = { ok: true } | { ok: false; error: string };

/**
 * Can `docId` move under `newParentId` (null = top level)? Refuses moving a
 * page into itself or into one of its own sub-pages, which would cut the
 * branch off the tree.
 */
export function checkDocMove(docs: Pick<TreeDoc, "id" | "parentId">[], docId: string, newParentId: string | null): MoveCheck {
  if (!docs.some((doc) => doc.id === docId)) return { ok: false, error: "That page no longer exists. Reload and try again." };
  if (newParentId === null) return { ok: true };
  if (newParentId === docId) return { ok: false, error: "A page can't be moved inside itself." };
  if (!docs.some((doc) => doc.id === newParentId)) return { ok: false, error: "Choose a page that still exists." };
  if (descendantIds(docs, docId).has(newParentId)) return { ok: false, error: "A page can't be moved inside one of its own sub-pages." };
  return { ok: true };
}

/**
 * New sibling order after placing `docId` at `index` among `siblingIds`
 * (the target parent's children in order; `docId` may or may not be among
 * them). Index is clamped to the list.
 */
export function placeAmongSiblings(siblingIds: string[], docId: string, index: number): string[] {
  const rest = siblingIds.filter((id) => id !== docId);
  const at = Math.max(0, Math.min(Number.isFinite(index) ? Math.trunc(index) : rest.length, rest.length));
  return [...rest.slice(0, at), docId, ...rest.slice(at)];
}

/** Flatten a forest depth-first with depth (for pickers such as "Move to"). */
export function flattenTree<T extends TreeDoc>(nodes: TreeNode<T>[], depth = 0): Array<{ node: TreeNode<T>; depth: number }> {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenTree(node.children, depth + 1)]);
}
