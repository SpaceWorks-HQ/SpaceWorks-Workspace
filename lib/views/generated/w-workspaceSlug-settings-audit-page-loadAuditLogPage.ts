// Generated from app/w/[workspaceSlug]/settings/audit/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { listAuditEvents } from "@/lib/audit";
import { requireWorkspace } from "@/lib/permissions";
function describeMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return "";
  return Object.entries(metadata as Record<string, unknown>).map(([key, value]) => `${key}: ${String(value)}`).join(", ");
}
export async function loadAuditLogPage({ params }: PageProps<"/w/[workspaceSlug]/settings/audit">) {
const { workspaceSlug } = await params;
const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
const events = await listAuditEvents(workspace.id, { take: 200 });
return viewDto({ workspace, events } as const);
}
