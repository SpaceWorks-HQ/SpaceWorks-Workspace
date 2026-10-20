// Generated from app/w/[workspaceSlug]/notifications/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { notificationCentre } from "@/lib/shell/notifications";

export async function loadNotificationsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/notifications">) {
const { workspaceSlug } = await params;
const { user, workspace } = await requireWorkspace(workspaceSlug);
const query = await searchParams;
const tab = typeof query.tab === "string" ? query.tab : "unread";
const category =
    typeof query.category === "string" ? query.category : undefined;
const raw =
    typeof query.before === "string" ? new Date(query.before) : undefined;
const before = raw && !isNaN(raw.getTime()) ? raw : undefined;
const data = await notificationCentre(workspace.id, user.id, {
    tab,
    category,
    before,
  });
const base = `/w/${workspaceSlug}/notifications`;
return viewDto({ workspace, tab, category, data, base } as const);
}
