import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { loadTools, type Filters } from "@/lib/marketingIt/service";
import { canManageItAdministration, canUseMarketingOperations } from "@/lib/roles";
import { ToolScreen } from "@/components/marketing-it/Screen";
import type { Kind } from "@/lib/marketingIt/schema";
export const metadata = { title: "IT administration" };
export default async function Page({ params, searchParams }: PageProps<"/w/[workspaceSlug]/it">) {
 const { workspaceSlug } = await params;
 const actor = await requireWorkspace(workspaceSlug, "MEMBER");
 if (!canUseMarketingOperations(actor.membership)) notFound();
 const query = await searchParams;
 const kind = (typeof query.tool === "string" ? query.tool : "DEVICE") as Kind;
 if (!["DEVICE", "LICENCE", "INCIDENT", "REVIEW", "RESTORE"].includes(kind) || (["PROPOSAL", "REVIEW", "RESTORE"].includes(kind) && !canManageItAdministration(actor.membership))) notFound();
 const filters: Filters = Object.fromEntries(Object.entries(query).map(([key, value]) => [key, typeof value === "string" ? value : undefined]));
 const edit = typeof query.edit === "string" ? query.edit : undefined;
 const data = await loadTools(actor, kind, filters, edit);
 if (edit && !data.selected) notFound();
 return <ToolScreen slug={workspaceSlug} timezone={actor.workspace.timezone} currency={actor.workspace.currency} kind={kind} filters={filters} data={data} create={query.new === "1" && !edit} />;
}
