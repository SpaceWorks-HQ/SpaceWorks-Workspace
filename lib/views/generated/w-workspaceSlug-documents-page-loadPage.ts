// Generated from app/w/[workspaceSlug]/documents/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listDocuments } from "@/lib/documents/queries";

export async function loadPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/documents">) {
const { workspaceSlug } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN");
const raw = await searchParams;
const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
const result = await listDocuments(actor, query);
const base = `/w/${workspaceSlug}/documents`;
return viewDto({ query, result, base } as const);
}
