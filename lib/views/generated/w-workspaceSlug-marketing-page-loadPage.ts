// Generated from app/w/[workspaceSlug]/marketing/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { loadTools, type Filters } from "@/lib/marketingIt/service";
import { canManageItAdministration, canUseMarketingOperations } from "@/lib/roles";
import type { Kind } from "@/lib/marketingIt/schema";

export async function loadPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/marketing">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canUseMarketingOperations(actor.membership)) notFound();
const query = await searchParams;
const kind = (typeof query.tool === "string" ? query.tool : "CONTENT") as Kind;
if (!["CONTENT", "BRAND", "PROPOSAL"].includes(kind) || (["PROPOSAL", "REVIEW", "RESTORE"].includes(kind) && !canManageItAdministration(actor.membership))) notFound();
const filters: Filters = Object.fromEntries(Object.entries(query).map(([key, value]) => [key, typeof value === "string" ? value : undefined]));
const edit = typeof query.edit === "string" ? query.edit : undefined;
const data = await loadTools(actor, kind, filters, edit);
if (edit && !data.selected) notFound();
return viewDto({ actor, kind, filters, edit, data } as const);
}
