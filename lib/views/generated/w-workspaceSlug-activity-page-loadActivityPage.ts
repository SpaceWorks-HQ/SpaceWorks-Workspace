// Generated from app/w/[workspaceSlug]/activity/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listActivity } from "@/lib/search/query";
import { searchActor } from "@/lib/shell/context";

export async function loadActivityPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/activity">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug);
const query = await searchParams;
const raw =
    typeof query.before === "string" ? new Date(query.before) : undefined;
const before = raw && !isNaN(raw.getTime()) ? raw : undefined;
const type =
    typeof query.type === "string" ? query.type.slice(0, 40) : undefined;
const rows = await listActivity(searchActor(ctx), before, type);
const base = `/w/${workspaceSlug}/activity`;
return viewDto({ ctx, type, rows, base } as const);
}
