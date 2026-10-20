// Generated from app/w/[workspaceSlug]/finance/reports/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace, canViewFinance } from "@/lib/permissions";
import type { FinanceQuery } from "@/lib/finance/tools/queries";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/finance/reports">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canViewFinance(actor.membership, actor.workspace)) notFound();
const raw = await searchParams;
const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as FinanceQuery;
return viewDto({ actor, query } as const);
}
