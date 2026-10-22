import Link from "next/link";
import { PageHeader, Card, Chip } from "@/components/ui/display";
import { ActionButton } from "@/components/notification-center/ActionButton";
import {
  notificationStateAction,
  muteNotificationResource,
} from "@/app/actions/notificationPreferences";
import { requireWorkspace } from "@/lib/permissions";
import { notificationCentre } from "@/lib/shell/notifications";
import { safeWorkspaceUrl } from "@/lib/shell/context";
import { NOTIFY_CATEGORIES } from "@/lib/notify/events";
import { formatRelativeTime } from "@/lib/format/datetime";
export const metadata = { title: "Notifications" };
export default async function NotificationsPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/notifications">) {
  const { workspaceSlug } = await params;
  const { user, workspace } = await requireWorkspace(workspaceSlug);
  const query = await searchParams;
  const tab = typeof query.tab === "string" ? query.tab : "unread";
  const category =
    typeof query.category === "string" ? query.category : undefined;
  const raw =
    typeof query.before === "string" ? new Date(query.before) : undefined;
  const before = raw && !isNaN(raw.getTime()) ? raw : undefined;
  const data = await notificationCentre(workspace.id, user.id, {
    tab,
    category,
    before,
  });
  const base = `/w/${workspaceSlug}/notifications`;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Notifications"
        description={`${data.unread} unread · ${data.mentions} unread mentions`}
        actions={
          <ActionButton
            disabled={!data.unread}
            action={notificationStateAction.bind(null, workspaceSlug, {
              operation: "all",
            })}
          >
            Mark all read
          </ActionButton>
        }
      />
      <div className="flex flex-wrap gap-3">
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`${base}/preferences`}
        >
          Preferences, quiet hours and snooze
        </Link>
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`${base}/accounts`}
        >
          Linked accounts
        </Link>
      </div>
      <nav
        aria-label="Notifications"
        className="flex gap-3 border-b border-line"
      >
        {["unread", "mentions", "all"].map((t) => (
          <Link
            key={t}
            href={`${base}?tab=${t}${category ? `&category=${encodeURIComponent(category)}` : ""}`}
            aria-current={tab === t ? "page" : undefined}
            className={`inline-flex min-h-11 items-center px-3 capitalize ${tab === t ? "border-b-2 border-accent-text font-semibold" : "text-ink-muted"}`}
          >
            {t}
          </Link>
        ))}
      </nav>
      <nav aria-label="Event category" className="flex flex-wrap gap-2">
        <Link
          className="inline-flex min-h-11 items-center px-3 underline"
          href={`${base}?tab=${tab}`}
        >
          Every category
        </Link>
        {Object.entries(NOTIFY_CATEGORIES).map(([key, spec]) => (
          <Link
            key={key}
            className={`inline-flex min-h-11 items-center rounded-md px-3 ${category === key ? "bg-primary text-on-primary" : "hover:bg-muted"}`}
            href={`${base}?tab=${tab}&category=${key}`}
            aria-current={category === key ? "page" : undefined}
          >
            {spec.label}
          </Link>
        ))}
      </nav>
      <Card>
        {data.items.length ? (
          <ul className="divide-y divide-line">
            {data.items.map((n) => (
              <li key={n.id} className="flex flex-col gap-3 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="break-words text-title">{n.title}</p>
                    {n.body ? (
                      <p className="mt-1 break-words text-body-ui text-ink-secondary">
                        {n.body}
                      </p>
                    ) : null}
                    <time
                      className="text-caption text-ink-muted"
                      dateTime={n.createdAt.toISOString()}
                    >
                      {formatRelativeTime(n.createdAt, workspace.timezone)}
                    </time>
                  </div>
                  {!n.readAt ? <Chip tone="accent">Unread</Chip> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {safeWorkspaceUrl(n.url, workspaceSlug) ? (
                    <Link
                      href={safeWorkspaceUrl(n.url, workspaceSlug)!}
                      className="inline-flex min-h-11 items-center px-3 underline"
                    >
                      Open
                    </Link>
                  ) : null}
                  <ActionButton
                    action={notificationStateAction.bind(null, workspaceSlug, {
                      operation: n.readAt ? "unread" : "read",
                      ids: [n.id],
                    })}
                  >
                    {n.readAt ? "Mark unread" : "Mark read"}
                  </ActionButton>
                  <ActionButton
                    action={notificationStateAction.bind(null, workspaceSlug, {
                      operation: "archive",
                      ids: [n.id],
                    })}
                  >
                    Archive
                  </ActionButton>
                  {n.event?.payload &&
                  typeof n.event.payload === "object" &&
                  "resource" in n.event.payload ? (
                    <ActionButton
                      action={muteNotificationResource.bind(
                        null,
                        workspaceSlug,
                        n.id,
                      )}
                    >
                      Mute these updates
                    </ActionButton>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            You’re all caught up.{" "}
            <Link className="underline" href={`/w/${workspaceSlug}`}>
              Back to my day
            </Link>
          </p>
        )}
      </Card>
      {data.items.length === 50 ? (
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`${base}?tab=${tab}${category ? `&category=${encodeURIComponent(category)}` : ""}&before=${data.items.at(-1)!.createdAt.toISOString()}`}
        >
          Earlier notifications
        </Link>
      ) : null}
    </div>
  );
}
