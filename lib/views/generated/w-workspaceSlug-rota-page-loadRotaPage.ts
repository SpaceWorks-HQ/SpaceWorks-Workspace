// Generated from app/w/[workspaceSlug]/rota/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageRota, canUseRota } from "@/lib/roles";
import { rotaData } from "@/lib/rota/rota";
import { listTeams } from "@/lib/teams/teams";
import { dayKey, parseDayKey } from "@/lib/community/schedule";
import { dayKeys, dayRange } from "@/lib/people/availability";

export async function loadRotaPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/rota">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canUseRota(ctx.membership)) notFound();
const q = await searchParams;
const start = parseDayKey(q.from) || dayKey(new Date(), ctx.workspace.timezone);
const days = dayKeys(start, 7);
const range = dayRange(days[0], days[6], ctx.workspace.timezone);
const [data, teams] = await Promise.all([rotaData(ctx, range.startsAt, range.endsAt), listTeams(ctx)]);
const managingTeams = teams.filter(t => canManageRota(ctx.membership) || t.myRole === "LEAD");
const manage = canManageRota(ctx.membership) || managingTeams.length > 0;
return viewDto({ ctx, start, data, managingTeams, manage } as const);
}
