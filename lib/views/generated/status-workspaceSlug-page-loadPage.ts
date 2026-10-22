// Generated from app/status/[workspaceSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { publicSummary, publicRateAllowed } from "@/lib/monitor/public";

export async function loadPage({ params }: PageProps<"/status/[workspaceSlug]">) {
const { workspaceSlug } = await params;
if (!await publicRateAllowed(new Headers(await headers()))) notFound();
const summary = await publicSummary(workspaceSlug);
if (!summary) notFound();
const banner: Record<string, string> = { UP: "All systems operational", DOWN: "Service interruption", DEGRADED: "Some services are degraded", MAINTENANCE: "Scheduled maintenance", UNKNOWN: "Service status unavailable", PENDING: "Waiting for the first check", PAUSED: "Monitoring paused" };
return viewDto({ summary, banner } as const);
}
