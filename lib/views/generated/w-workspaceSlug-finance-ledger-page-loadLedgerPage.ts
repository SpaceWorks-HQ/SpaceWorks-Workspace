// Generated from app/w/[workspaceSlug]/finance/ledger/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { localDate } from "@/lib/finance/dates";
import { hasActiveFilters, parseLedgerFilters } from "@/lib/finance/filters";
import { listBudgetOptions, listCategories, listLedger } from "@/lib/finance/queries";
import { formatMoney } from "@/lib/format/money";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

export async function loadLedgerPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/ledger">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewFinance(membership, workspace)) notFound();
const query = await searchParams;
const filters = parseLedgerFilters(query);
const manage = canManageFinance(membership);
const [ledger, categories, budgets] = await Promise.all([
    listLedger(workspace, filters),
    listCategories(workspace.id, { includeArchived: true }),
    manage ? listBudgetOptions(workspace.id) : Promise.resolve([]),
  ]);
const base = `/w/${workspace.slug}`;
const ledgerHref = `${base}/finance/ledger`;
const money = (minor: number, currency = workspace.currency) => formatMoney(minor, currency);
const shared = {
    slug: workspace.slug,
    currency: workspace.currency,
    today: localDate(new Date(), workspace.timezone),
    categories: categories.map((c) => ({ id: c.id, name: c.name, kind: c.kind, archived: c.archived })),
    budgets: budgets.filter((b) => b.currency === workspace.currency).map((b) => ({ id: b.id, name: b.name })),
  };
const filtered = hasActiveFilters(filters);
const { page: _page, ...withoutPage } = filters;
void _page;
return viewDto({ workspace, filters, manage, ledger, categories, budgets, base, ledgerHref, shared, filtered, withoutPage } as const);
}
