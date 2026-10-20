// Generated from app/w/[workspaceSlug]/calendar/new/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { safeTimeZone } from "@/lib/timeZone";
import { dayKey, parseDayKey } from "@/lib/community/schedule";

export async function loadNewEventPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/calendar/new">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const query = await searchParams;
const tz = safeTimeZone(ctx.workspace.timezone);
const now = new Date();
const today = dayKey(now, tz);
const picked = parseDayKey(query.date);
const day = picked && picked >= today ? picked : today;
return viewDto({ ctx, tz, now, day } as const);
}
