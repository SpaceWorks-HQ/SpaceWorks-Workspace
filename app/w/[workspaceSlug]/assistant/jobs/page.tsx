import { JobsManager } from "@/components/assistant/JobsManager";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";
import { formatDayTime, formatRelativeTime } from "@/lib/format/datetime";
import { listPickableDestinations } from "@/lib/notify";
import { getAssistantSettings } from "@/lib/instanceSettings";

export const metadata = { title: "Scheduled jobs" };

export default async function AssistantJobsPage({ params }: PageProps<"/w/[workspaceSlug]/assistant/jobs">) {
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
  const now = new Date();
  return (
    <JobsManager
      slug={workspace.slug}
      configured={Boolean(settings.apiKey)}
      defaultTimeZone={workspace.timezone}
      channels={channels.map((c) => ({ id: c.id, label: `${c.kind === "PRIVATE" ? "Private: " : "#"}${c.name}` }))}
      destinations={destinations.map((d) => ({ id: d.id, name: d.name, kind: d.kind }))}
      jobs={jobs.map((job) => ({
        id: job.id,
        name: job.name,
        cron: job.cron,
        timezone: job.timezone,
        prompt: job.prompt,
        channelId: job.channelId,
        channelSlug: job.channel?.slug ?? null,
        enabled: job.enabled,
        destinationIds: sendTo.get(job.id) ?? [],
        lastRun: job.lastRunAt ? formatRelativeTime(job.lastRunAt, workspace.timezone, now) : null,
        nextRun: job.enabled && job.nextRunAt ? formatDayTime(job.nextRunAt, job.timezone) : null,
        lastStatus: job.lastStatus,
      }))}
    />
  );
}
