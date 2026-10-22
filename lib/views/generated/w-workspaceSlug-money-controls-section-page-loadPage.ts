// Generated from app/w/[workspaceSlug]/money-controls/[section]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { loadControlsView } from "@/lib/moneyControls/queries";
import { SECTIONS, type Section, type ControlsQuery } from "@/lib/moneyControls/rules";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/money-controls/[section]">) {
const { workspaceSlug, section } = await params;
const actor = await requireWorkspace(workspaceSlug, "MEMBER");
if (!Object.hasOwn(SECTIONS, section)) notFound();
const raw = await searchParams,
    query = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
    );
const view = await loadControlsView(
    actor,
    section as Section,
    query as ControlsQuery,
    query.edit,
    query.new,
  );
return viewDto({ view } as const);
}
