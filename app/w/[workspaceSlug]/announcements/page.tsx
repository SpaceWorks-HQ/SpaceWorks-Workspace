import Link from "next/link";
import { Plus } from "lucide-react";
import { AnnouncementActions } from "@/components/community/AnnouncementActions";
import { LiveRefresh } from "@/components/community/LiveRefresh";
import { Button } from "@/components/ui/button";
import { Avatar, Card, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { formatDayTime, formatRelativeTime, formatTimeZoneName } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canManageAnnouncements } from "@/lib/community/access";
import { listAnnouncements } from "@/lib/community/announcements";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage({ params }: PageProps<"/w/[workspaceSlug]/announcements">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const { workspace } = ctx;
  const tz = workspace.timezone;
  const manage = canManageAnnouncements(ctx.membership);
  const announcements = await listAnnouncements(ctx);
  const base = `/w/${workspace.slug}/announcements`;

  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh slug={workspace.slug} types={["community.announcement.changed"]} />
      <PageHeader
        title="Announcements"
        description="News and notices from the organisers."
        actions={
          manage ? (
            <Button asChild variant="primary">
              <Link href={`${base}/new`}>
                <Plus aria-hidden className="size-[18px]" />
                New announcement
              </Link>
            </Button>
          ) : null
        }
      />
      {announcements.length === 0 ? (
        <EmptyState
          title="No announcements yet."
          action={
            manage ? (
              <Button asChild variant="primary">
                <Link href={`${base}/new`}>Write the first one</Link>
              </Button>
            ) : null
          }
        >
          {manage ? "Share news with the crew: build night plans, space updates, wins." : "News from the organisers shows up here."}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {announcements.map((item) => (
            <li key={item.id}>
              <Card as="article" className="flex gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {item.pinned ? <Chip tone="highlight" size="sm">Pinned</Chip> : null}
                    {item.status === "scheduled" ? (
                      <Chip tone="info" size="sm">Scheduled · {formatDayTime(item.publishedAt!, tz)} {formatTimeZoneName(item.publishedAt!, tz)}</Chip>
                    ) : null}
                    {item.status === "draft" ? <Chip tone="outline" size="sm">Draft</Chip> : null}
                  </div>
                  <h2 className="mt-1.5 text-h4 text-ink">
                    <Link href={`${base}/${item.id}`} className="underline-offset-4 hover:underline">{item.title}</Link>
                  </h2>
                  {item.preview ? <p className="mt-1.5 line-clamp-3 text-body-ui text-ink-secondary">{item.preview}</p> : null}
                  <p className="mt-3 flex items-center gap-2 text-caption text-ink-muted">
                    <Avatar name={item.author?.name ?? "Former member"} src={item.author?.image} size="xs" />
                    <span>
                      {item.author?.name ?? "Former member"}
                      {item.status === "published" ? ` · ${formatRelativeTime(item.publishedAt!, tz)}` : ` · edited ${formatRelativeTime(item.updatedAt, tz)}`}
                    </span>
                  </p>
                </div>
                {manage ? <AnnouncementActions slug={workspace.slug} id={item.id} title={item.title} pinned={item.pinned} /> : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
