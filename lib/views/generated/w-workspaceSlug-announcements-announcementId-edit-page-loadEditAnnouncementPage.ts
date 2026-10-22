// Generated from app/w/[workspaceSlug]/announcements/[announcementId]/edit/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { announcementDestinations, getAnnouncement } from "@/lib/community/announcements";

export async function loadEditAnnouncementPage({ params }: PageProps<"/w/[workspaceSlug]/announcements/[announcementId]/edit">) {
const { workspaceSlug, announcementId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "ADMIN");
const announcement = await getAnnouncement(ctx, announcementId);
if (!announcement) notFound();
const { options, selected } = await announcementDestinations(ctx, announcement.id);
const tz = ctx.workspace.timezone;
return viewDto({ ctx, announcement, options, selected, tz } as const);
}
