// Generated from app/w/[workspaceSlug]/members/availability/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { listMembers } from "@/lib/people/profiles";
import { visibleAvailability } from "@/lib/people/away";
import { timeOffRequests } from "@/lib/people/timeOff";
import { availabilityStrip, dayKeys, dayRange } from "@/lib/people/availability";
import { dayKey, parseDayKey } from "@/lib/community/schedule";

export async function loadAvailabilityPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/members/availability">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const q = await searchParams;
const start = parseDayKey(q.from) || dayKey(new Date(), ctx.workspace.timezone);
const days = dayKeys(start, 7);
const people = await listMembers(ctx, { team: typeof q.team === "string" ? q.team : undefined });
const [periods, requests] = await Promise.all([visibleAvailability(ctx, people.map(p => p.id), dayRange(days[0], days[6], ctx.workspace.timezone)), timeOffRequests(ctx)]);
const strip = availabilityStrip(people, periods, days, ctx.workspace.timezone);
return viewDto({ ctx, start, days, people, periods, requests, strip } as const);
}
