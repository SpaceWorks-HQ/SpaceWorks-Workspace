import { auth } from "@/lib/auth";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { ledgerToCsv } from "@/lib/finance/csv";
import { localDate } from "@/lib/finance/dates";
import { parseLedgerFilters } from "@/lib/finance/filters";
import { ledgerForExport } from "@/lib/finance/queries";
import { canViewFinance, findWorkspaceForUser } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** CSV of the ledger with the same filters as the list. Anyone who can see finance may export it. */
export async function GET(request: Request, ctx: RouteContext<"/w/[workspaceSlug]/finance/ledger/export">) {
  const { workspaceSlug } = await ctx.params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return notFound();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) return notFound();
  const context = await findWorkspaceForUser(workspaceSlug, userId);
  if (!context || !canViewFinance(context.membership, context.workspace)) return notFound();
  const { workspace } = context;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const { page: _page, ...filters } = parseLedgerFilters(params);
  void _page;
  const entries = await ledgerForExport(workspace.id, filters);
  if (entries.length > 20_000) return new Response("This export has more than 20,000 entries. Narrow the date range or filters and export again.", { status: 422, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
  await recordAuditEvent({ action: "finance.ledger_exported", workspaceId: workspace.id, actorId: userId, targetType: "ledger", metadata: { count: entries.length } });
  const csv = ledgerToCsv(entries.map((entry) => ({ ...entry, categoryName: entry.category?.name ?? null })));
  const filename = `${workspace.slug}-ledger-${localDate(new Date(), workspace.timezone)}.csv`;
  return new Response(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
