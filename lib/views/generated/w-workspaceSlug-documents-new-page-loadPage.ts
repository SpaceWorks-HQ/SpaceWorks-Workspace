// Generated from app/w/[workspaceSlug]/documents/new/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { editorOptions } from "@/lib/documents/queries";
import { sourceDraft } from "@/lib/documents/sources";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/documents/new">) {
const { workspaceSlug } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN"),
    options = await editorOptions(actor);
const raw = await searchParams;
const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
const initial = await sourceDraft(actor, options.country, query);
return viewDto({ workspaceSlug, options, initial } as const);
}
