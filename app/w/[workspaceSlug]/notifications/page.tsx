import Link from "next/link";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { MarkAllReadButton } from "@/components/workspace/MarkAllReadButton";
import { formatRelativeTime } from "@/lib/format/datetime";
import { listNotifications } from "@/lib/notifications";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ params }: PageProps<"/w/[workspaceSlug]/notifications">) {
  const { workspaceSlug } = await params;
  const { user, workspace } = await requireWorkspace(workspaceSlug);
  const notifications = await listNotifications(user.id, { workspaceId: workspace.id, take: 100 });
  const unread = notifications.filter((n) => !n.readAt).length;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Notifications" description="Mentions, assignments and news meant for you." actions={<MarkAllReadButton disabled={unread === 0} />} />
      {notifications.length === 0 ? (
        <EmptyState mood="sleepy" title="You're all caught up.">New mentions and assignments show up here.</EmptyState>
      ) : (
        <Card padding="none">
          <ul className="divide-y divide-line">
            {notifications.map((notification) => {
              const body = (
                <span className="flex items-start gap-3 px-5 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-label text-ink">{notification.title}</span>
                    {notification.body ? <span className="mt-0.5 block text-body-ui text-ink-secondary">{notification.body}</span> : null}
                    <span className="mt-0.5 block text-caption text-ink-muted">{formatRelativeTime(notification.createdAt, workspace.timezone)}</span>
                  </span>
                  {notification.readAt ? null : <Chip tone="accent" size="sm">New</Chip>}
                </span>
              );
              return (
                <li key={notification.id}>
                  {notification.url ? <Link href={notification.url} className="block transition-colors hover:bg-subtle">{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
