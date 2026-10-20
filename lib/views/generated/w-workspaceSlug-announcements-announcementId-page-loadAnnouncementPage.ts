// Generated from app/w/[workspaceSlug]/announcements/[announcementId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getAnnouncement } from "@/lib/community/announcements";

export async function loadAnnouncementPage({ params }: PageProps<"/w/[workspaceSlug]/announcements/[announcementId]">) {
const { workspaceSlug, announcementId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const announcement = await getAnnouncement(ctx, announcementId);
if (!announcement) notFound();
const tz = ctx.workspace.timezone;
const base = `/w/${ctx.workspace.slug}/announcements`;
return viewDto({ ctx, announcement, tz, base } as const);
}
