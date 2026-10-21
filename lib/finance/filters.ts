/**
 * Ledger filters from URL search params (pure, client-safe). Unknown or
 * malformed values are dropped rather than rejected, so a hand-edited URL
 * still shows something sensible.
 */

import { isValidIsoDate } from "@/lib/finance/csv";
import type { LedgerKindValue } from "@/lib/finance/money";

export type LedgerFilters = {
  recordId?: string;
  kind: LedgerKindValue | null;
  categoryId: string | null;
  from: string | null;
  to: string | null;
  q: string | null;
  includeVoided: boolean;
  page: number;
};

export const LEDGER_PAGE_SIZE = 50;

type Params = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export function parseLedgerFilters(params: Params): LedgerFilters {
  const kind = first(params.kind).toUpperCase();
  const categoryId = first(params.category);
  let from = first(params.from);
  let to = first(params.to);
  if (!isValidIsoDate(from)) from = "";
  if (!isValidIsoDate(to)) to = "";
  if (from && to && from > to) [from, to] = [to, from];
  const page = Number.parseInt(first(params.page), 10);
  return {
    ...(/^[A-Za-z0-9_-]{1,64}$/.test(first(params.record)) ? {recordId:first(params.record)} : {}),
    kind: kind === "INCOME" || kind === "EXPENSE" ? kind : null,
    categoryId: /^[A-Za-z0-9_-]{1,64}$/.test(categoryId) ? categoryId : null,
    from: from || null,
    to: to || null,
    q: first(params.q).slice(0, 100) || null,
    includeVoided: first(params.voided) === "1",
    page: Number.isSafeInteger(page) && page > 0 && page <= 10_000 ? page : 1,
  };
}

/** Back to a query string (page omitted unless > 1). */
export function ledgerFiltersToQuery(filters: Partial<LedgerFilters>): string {
  const query = new URLSearchParams();
  if (filters.recordId) query.set("record", filters.recordId);
  if (filters.kind) query.set("kind", filters.kind.toLowerCase());
  if (filters.categoryId) query.set("category", filters.categoryId);
  if (filters.from) query.set("from", filters.from);
  if (filters.to) query.set("to", filters.to);
  if (filters.q) query.set("q", filters.q);
  if (filters.includeVoided) query.set("voided", "1");
  if (filters.page && filters.page > 1) query.set("page", String(filters.page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export function hasActiveFilters(filters: LedgerFilters): boolean {
  return Boolean(filters.recordId || filters.kind || filters.categoryId || filters.from || filters.to || filters.q || filters.includeVoided);
}
