// Generated from app/w/[workspaceSlug]/announcements/new/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { announcementDestinations } from "@/lib/community/announcements";

export async function loadNewAnnouncementPage({ params }: PageProps<"/w/[workspaceSlug]/announcements/new">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "ADMIN");
const { options } = await announcementDestinations(ctx, null);
const tz = ctx.workspace.timezone;
return viewDto({ ctx, options, tz } as const);
}
