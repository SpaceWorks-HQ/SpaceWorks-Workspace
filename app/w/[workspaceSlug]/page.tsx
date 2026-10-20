import Link from "next/link";
import { QuickCreateButtons } from "@/components/command-palette/QuickCreate";
import {
  Card,
  CardHeader,
  Chip,
  PageHeader,
  StatTile,
} from "@/components/ui/display";
import { getDashboardData } from "@/lib/dashboard";
import {
  formatDayTime,
  formatRelativeTime,
  formatTimeZoneName,
} from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/money";
import { requireWorkspace } from "@/lib/permissions";
import { canContribute, canViewServices } from "@/lib/roles";
import { taskUrl } from "@/lib/tasks/links";
import { shellMessage } from "@/lib/shell/messages";
export const metadata = { title: "My day" };
export default async function WorkspaceHome({
  params,
}: PageProps<"/w/[workspaceSlug]">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug);
  const d = await getDashboardData(workspace, user.id, membership);
  const base = `/w/${workspace.slug}`;
  const tz = workspace.timezone;
  const upcoming = [
    ...d.meetings.map((m) => ({
      ...m,
      href: `${base}/meetings/${m.id}`,
      kind: "Meeting",
    })),
    ...d.shifts.map((s) => ({
      id: s.id,
      title: s.shiftType.name,
      startsAt: s.startsAt,
      href: `${base}/rota`,
      kind: "Shift",
    })),
  ]
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .slice(0, 8);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        kicker={workspace.name}
        title={shellMessage(workspace.defaultLocale, "home")}
        description={`${user.name ? `Hello, ${user.name.split(" ")[0]}. ` : ""}${workspace.tagline ?? "Make room for your next good build."}`}
      />
      <section
        aria-label="Overview"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        <StatTile
          label="My open tasks"
          value={d.myOpenTasks}
          href={canContribute(membership) ? `${base}/my-tasks` : undefined}
        />
        <StatTile
          label="Members"
          value={d.memberCount}
          href={`${base}/members`}
        />
        <StatTile
          label="Coming up"
          value={upcoming.length}
          href={`${base}/meetings`}
        />
        {d.kittyMinor !== null ? (
          <StatTile
            label="The kitty"
            value={formatMoney(d.kittyMinor, workspace.currency)}
            href={`${base}/finance`}
          />
        ) : (
          <StatTile
            label="Unread mentions"
            value={d.mentions.length}
            href={`${base}/notifications?tab=mentions`}
          />
        )}
      </section>
      <nav aria-label="Quick actions" className="flex flex-wrap gap-3">
        {canContribute(membership) ? (
          <QuickCreateButtons slug={workspaceSlug} userId={user.id} />
        ) : null}
        <Link
          className="inline-flex min-h-11 items-center px-3 underline"
          href={`${base}/search`}
        >
          Search workspace
        </Link>
        <Link
          className="inline-flex min-h-11 items-center px-3 underline"
          href={`${base}/links`}
        >
          Links
        </Link>
      </nav>
      <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 flex-col gap-5">
          {canContribute(membership) ? (
            <Card>
              <CardHeader
                title="My tasks"
                action={
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    href={`${base}/my-tasks`}
                  >
                    See all
                  </Link>
                }
              />
              {d.myTasks.length ? (
                <ul className="divide-y divide-line">
                  {d.myTasks.map((task) => (
                    <li key={task.id} className="flex items-center gap-3 py-3">
                      <Link
                        className="min-w-0 flex-1 break-words text-label underline-offset-4 hover:underline"
                        href={taskUrl(
                          workspaceSlug,
                          task.project?.key,
                          task.number,
                        )}
                      >
                        {task.title}
                        <span className="mt-1 block text-caption text-ink-muted">
                          {task.project?.key ?? "Task"}-{task.number}
                          {task.dueAt
                            ? ` · ${formatDayTime(task.dueAt, tz)}`
                            : ""}
                        </span>
                      </Link>
                      {task.dueAt ? (
                        <Chip tone={task.dueAt < d.now ? "danger" : "neutral"}>
                          {task.dueAt < d.now ? "Overdue" : "Due"}
                        </Chip>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>
                  No tasks assigned.{" "}
                  <Link className="underline" href={`${base}/projects`}>
                    Browse projects
                  </Link>
                </p>
              )}
            </Card>
          ) : null}
          <Card>
            <CardHeader
              title="Upcoming"
              description={`Times in ${formatTimeZoneName(d.now, tz)}`}
              action={
                <Link
                  className="inline-flex min-h-11 items-center underline"
                  href={`${base}/meetings`}
                >
                  Meetings
                </Link>
              }
            />
            {upcoming.length ? (
              <ul className="divide-y divide-line">
                {upcoming.map((e) => (
                  <li
                    className="flex items-center gap-3 py-3"
                    key={`${e.kind}:${e.id}`}
                  >
                    <Link
                      href={e.href}
                      className="min-w-0 flex-1 break-words text-label hover:underline"
                    >
                      {e.title}
                      <span className="block text-caption text-ink-muted">
                        {formatDayTime(e.startsAt, tz)}
                      </span>
                    </Link>
                    <Chip tone="info">{e.kind}</Chip>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Nothing planned.{" "}
                <Link className="underline" href={`${base}/meetings`}>
                  Schedule a meeting
                </Link>
              </p>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Announcements"
              action={
                <Link
                  className="inline-flex min-h-11 items-center underline"
                  href={`${base}/announcements`}
                >
                  See all
                </Link>
              }
            />
            {d.announcements.length ? (
              <ul className="divide-y divide-line">
                {d.announcements.map((a) => (
                  <li className="py-3" key={a.id}>
                    <Link
                      href={`${base}/announcements/${a.id}`}
                      className="text-title hover:underline"
                    >
                      {a.title}
                    </Link>
                    {a.pinned ? (
                      <span className="ml-2">
                        <Chip>Pinned</Chip>
                      </span>
                    ) : null}
                    <p className="mt-1 line-clamp-2 text-body-ui text-ink-secondary">
                      {a.preview}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                No announcements yet.{" "}
                <Link className="underline" href={`${base}/announcements`}>
                  Visit announcements
                </Link>
              </p>
            )}
          </Card>
          {d.mentions.length ? (
            <Card>
              <CardHeader title="Mentions" />
              <ul className="divide-y divide-line">
                {d.mentions.map((n) => (
                  <li key={n.id}>
                    <Link
                      className="block min-h-11 py-3 text-label hover:underline"
                      href={`${base}/notifications?tab=mentions`}
                    >
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {d.unrepliedLowRatings !== null ? <StatTile label="Unreplied low ratings" value={d.unrepliedLowRatings} href={`${base}/app-reviews?replied=no&sort=lowest`} /> : null}
          {canViewServices(membership) ? (
            <Card>
              <CardHeader
                title="Services status"
                action={
                  <Link
                    className="inline-flex min-h-11 items-center underline"
                    href={`${base}/services`}
                  >
                    Services
                  </Link>
                }
              />
              {!d.services.length ? <p>No monitors yet. <Link className="underline" href={`${base}/services`}>Open services</Link></p> : null}
              <div className="flex flex-wrap gap-3">
                {d.services.map((s) => (
                  <Chip
                    key={s.lastStatus}
                    tone={
                      s.lastStatus === "DOWN"
                        ? "danger"
                        : s.lastStatus === "UP"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {s._count} {s.lastStatus.toLowerCase().replaceAll("_", " ")}
                  </Chip>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
        <aside aria-label="Recent activity" className="min-w-0">
          <Card>
            <CardHeader
              title="Activity"
              action={
                <Link
                  className="inline-flex min-h-11 items-center underline"
                  href={`${base}/activity`}
                >
                  See all
                </Link>
              }
            />
            {d.activity.length ? (
              <ul className="divide-y divide-line">
                {d.activity.map((a) => (
                  <li className="py-3" key={a.id}>
                    <p className="break-words text-body-ui">{a.summary}</p>
                    <time
                      className="text-caption text-ink-muted"
                      dateTime={a.createdAt.toISOString()}
                    >
                      {formatRelativeTime(a.createdAt, tz)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                It’s quiet here.{" "}
                <Link className="underline" href={`${base}/activity`}>
                  Open activity
                </Link>
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
