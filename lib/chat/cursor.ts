/**
 * Keyset pagination for messages (pure). Messages are ordered by
 * (createdAt, id); a cursor is that pair, base64url-encoded so clients treat
 * it as opaque.
 */

export const PAGE_SIZE = 50;

export type Cursor = { createdAt: Date; id: string };

export function encodeCursor(row: { createdAt: Date | string; id: string }): string {
  const iso = new Date(row.createdAt).toISOString();
  return Buffer.from(`${iso}|${row.id}`, "utf8").toString("base64url");
}

export function decodeCursor(value: unknown): Cursor | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 200) return null;
  let raw: string;
  try {
    raw = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [iso, id, extra] = raw.split("|");
  if (!iso || !id || extra !== undefined || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const createdAt = new Date(iso);
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) return null;
  return { createdAt, id };
}

/** Prisma `where` for rows strictly before the cursor in (createdAt, id) order. */
export function beforeCursor(cursor: Cursor) {
  return { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] };
}

/** Prisma `where` for rows strictly after the cursor. */
export function afterCursor(cursor: Cursor) {
  return { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] };
}

/**
 * Callers fetch `limit + 1` rows; the extra row only says there is more.
 * `rows` must already be in the fetch order.
 */
export function takePage<T>(rows: T[], limit: number): { items: T[]; hasMore: boolean } {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

export function clampLimit(value: unknown, fallback = PAGE_SIZE, max = 100): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, 1), max);
}
