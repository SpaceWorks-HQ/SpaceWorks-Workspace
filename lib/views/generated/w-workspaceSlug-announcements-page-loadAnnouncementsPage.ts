// Generated from app/w/[workspaceSlug]/announcements/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { canManageAnnouncements } from "@/lib/community/access";
import { listAnnouncements } from "@/lib/community/announcements";

export async function loadAnnouncementsPage({ params }: PageProps<"/w/[workspaceSlug]/announcements">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const { workspace } = ctx;
const tz = workspace.timezone;
const manage = canManageAnnouncements(ctx.membership);
const announcements = await listAnnouncements(ctx);
const base = `/w/${workspace.slug}/announcements`;
return viewDto({ workspace, tz, manage, announcements, base } as const);
}
