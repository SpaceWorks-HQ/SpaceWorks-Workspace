import Link from "next/link";
import { Card, CardHeader, Chip, EmptyState, PageHeader, StatTile } from "@/components/ui/display";
import { getDashboardData } from "@/lib/dashboard";
import { formatDayTime, formatRelativeTime } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/money";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Home" };

const PRIORITY: Record<string, { label: string; tone: "danger" | "warning" | "info" | "neutral" } | null> = {
  URGENT: { label: "Urgent", tone: "danger" },
  HIGH: { label: "High", tone: "warning" },
  MEDIUM: { label: "Medium", tone: "info" },
  LOW: { label: "Low", tone: "neutral" },
  NONE: null,
};

const EVENT_KIND: Record<string, string> = { BUILD_NIGHT: "Build night", MEETUP: "Meetup", WORKSHOP: "Workshop", OTHER: "Event" };

export default async function WorkspaceHome({ params }: PageProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug);
  const data = await getDashboardData(workspace, user.id, membership);
  const base = `/w/${workspace.slug}`;
  const tz = workspace.timezone;
  const firstName = user.name?.split(" ")[0];

  return (
    <div className="flex flex-col gap-8">
      <PageHeader kicker={workspace.name} title={firstName ? `Hello, ${firstName}.` : "Hello."} description={workspace.tagline ?? "Here's what the crew is up to."} />

      <section aria-label="Overview" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="My open tasks" value={data.myOpenTasks} href={`${base}/my-tasks`} />
        <StatTile label="Members" value={data.memberCount} href={`${base}/members`} />
        <StatTile label="Upcoming events" value={data.upcomingEvents.length} href={`${base}/calendar`} />
        {data.kittyMinor !== null ? (
          <StatTile label="The kitty" value={formatMoney(data.kittyMinor, workspace.currency)} href={`${base}/finance`} />
        ) : (
          <StatTile label="Shoutouts lately" value={data.recentShoutouts.length} href={`${base}/shoutouts`} />
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="My tasks" action={<Link href={`${base}/my-tasks`} className="text-sm font-semibold text-ink underline-offset-4 hover:underline">See all</Link>} />
          {data.myTasks.length === 0 ? (
            <EmptyState className="border-0 p-2" title="Nothing assigned to you.">Pick something up from a project board.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {data.myTasks.map((task) => {
                const priority = PRIORITY[task.priority];
                return (
                  <li key={task.id} className="flex items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-ui text-ink">{task.title}</span>
                      <span className="block text-caption tabular-nums text-ink-muted">
                        {task.project ? `${task.project.key}-${task.number}` : `#${task.number}`}
                        {task.dueAt ? ` · due ${formatDayTime(task.dueAt, tz)}` : ""}
                      </span>
                    </span>
                    {priority ? <Chip tone={priority.tone} size="sm">{priority.label}</Chip> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Announcements" action={<Link href={`${base}/announcements`} className="text-sm font-semibold text-ink underline-offset-4 hover:underline">See all</Link>} />
          {data.announcements.length === 0 ? (
            <EmptyState className="border-0 p-2" title="No announcements yet.">News from the organisers shows up here.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {data.announcements.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 py-2.5">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-label text-ink">{item.title}</span>
                    {item.pinned ? <Chip tone="highlight" size="sm">Pinned</Chip> : null}
                  </span>
                  <span className="line-clamp-2 text-body-ui text-ink-secondary">{item.body}</span>
                  <span className="text-caption text-ink-muted">
                    {item.author?.name ?? "A member"} · {item.publishedAt ? formatRelativeTime(item.publishedAt, tz) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Upcoming" action={<Link href={`${base}/calendar`} className="text-sm font-semibold text-ink underline-offset-4 hover:underline">Calendar</Link>} />
          {data.upcomingEvents.length === 0 ? (
            <EmptyState className="border-0 p-2" title="No events planned.">Put the next build night on the calendar.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {data.upcomingEvents.map((event) => (
                <li key={event.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-ui text-ink">{event.title}</span>
                    <span className="block text-caption text-ink-muted">{formatDayTime(event.startsAt, tz)}{event.location ? ` · ${event.location}` : ""}</span>
                  </span>
                  <Chip tone="info" size="sm">{EVENT_KIND[event.kind] ?? "Event"}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Recent activity" />
          {data.recentTasks.length === 0 && data.recentShoutouts.length === 0 ? (
            <EmptyState className="border-0 p-2" title="It's quiet here.">Start a project for the next build night.</EmptyState>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {data.recentShoutouts.map((shoutout) => (
                <li key={shoutout.id} className="flex flex-col gap-0.5 py-2.5">
                  <span className="text-body-ui text-ink">{shoutout.from.name ?? "A member"} gave {shoutout.to.name ?? "a member"} a shoutout</span>
                  <span className="line-clamp-1 text-caption text-ink-muted">{shoutout.message}</span>
                </li>
              ))}
              {data.recentTasks.map((task) => (
                <li key={task.id} className="flex items-center gap-3 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-body-ui text-ink">{task.title}</span>
                  <span className="shrink-0 text-caption text-ink-muted">{task.completedAt ? "Done" : "Updated"} {formatRelativeTime(task.updatedAt, tz).toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
