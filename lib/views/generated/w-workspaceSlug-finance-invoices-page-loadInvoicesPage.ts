// Generated from app/w/[workspaceSlug]/finance/invoices/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { localDate } from "@/lib/finance/dates";
import { parseLedgerFilters } from "@/lib/finance/filters";
import { INVOICE_STATUSES, type InvoiceStatusValue } from "@/lib/finance/invoice";
import { listInvoices } from "@/lib/finance/queries";
import { canManageFinance, canViewFinance, requireWorkspace } from "@/lib/permissions";

export async function loadInvoicesPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/finance/invoices">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewFinance(membership, workspace)) notFound();
const query = await searchParams;
const raw = String(query.status ?? "").toUpperCase();
const { page } = parseLedgerFilters(query);
const status = (INVOICE_STATUSES as readonly string[]).includes(raw) ? (raw as InvoiceStatusValue) : null;
const { invoices, counts, pageCount } = await listInvoices(workspace.id, status, page);
if (page > pageCount) notFound();
const href = `/w/${workspace.slug}/finance/invoices`;
const today = localDate(new Date(), workspace.timezone);
const manage = canManageFinance(membership);
const total = Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
const pageHref = (n: number) => `${href}?${status ? `status=${status.toLowerCase()}&` : ""}page=${n}`;
return viewDto({ workspace, page, status, invoices, counts, pageCount, href, today, manage, total } as const);
}
