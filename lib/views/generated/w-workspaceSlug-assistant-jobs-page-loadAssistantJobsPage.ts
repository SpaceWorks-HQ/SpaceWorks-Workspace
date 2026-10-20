// Generated from app/w/[workspaceSlug]/assistant/jobs/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";
import { listPickableDestinations } from "@/lib/notify";
import { getAssistantSettings } from "@/lib/instanceSettings";

export async function loadAssistantJobsPage({ params }: PageProps<"/w/[workspaceSlug]/assistant/jobs">) {
const { workspaceSlug } = await params;
const { workspace, membership } = await requireWorkspace(workspaceSlug, "ADMIN");
const [jobs, channels, destinations, rules, settings] = await Promise.all([
    prisma.scheduledJob.findMany({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, cron: true, timezone: true, prompt: true, channelId: true, enabled: true, lastRunAt: true, nextRunAt: true, lastStatus: true, channel: { select: { slug: true } } },
    }),
    prisma.channel.findMany({ where: { workspaceId: workspace.id, archivedAt: null, kind: { not: "DIRECT" } }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    listPickableDestinations(workspace.id, membership.role),
    prisma.notificationRule.findMany({
      where: { workspaceId: workspace.id, scopeType: "DIGEST" },
      select: { scopeId: true, destinations: { select: { destinationId: true } } },
    }),
    getAssistantSettings(),
  ]);
const sendTo = new Map(rules.map((rule) => [rule.scopeId, rule.destinations.map((d) => d.destinationId)]));
const configured = Boolean(settings.apiKey);
const now = new Date();
return viewDto({ workspace, jobs, channels, destinations, sendTo, configured, now } as const);
}
