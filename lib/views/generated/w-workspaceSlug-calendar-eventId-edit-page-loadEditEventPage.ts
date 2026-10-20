// Generated from app/w/[workspaceSlug]/calendar/[eventId]/edit/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { safeTimeZone } from "@/lib/timeZone";
import { getEventDetail } from "@/lib/community/events";

export async function loadEditEventPage({ params }: PageProps<"/w/[workspaceSlug]/calendar/[eventId]/edit">) {
const { workspaceSlug, eventId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const event = await getEventDetail(ctx, eventId);
if (!event || !event.canEdit || event.cancelledAt) notFound();
const tz = safeTimeZone(ctx.workspace.timezone);
return viewDto({ ctx, event, tz } as const);
}
