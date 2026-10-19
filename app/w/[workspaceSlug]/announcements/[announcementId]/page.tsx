import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { AnnouncementActions } from "@/components/community/AnnouncementActions";
import { Avatar, Chip, PageHeader } from "@/components/ui/display";
import { formatDate, formatDayTime, formatTimeZoneName } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canManageAnnouncements } from "@/lib/community/access";
import { getAnnouncement } from "@/lib/community/announcements";

export const metadata = { title: "Announcement" };

export default async function AnnouncementPage({ params }: PageProps<"/w/[workspaceSlug]/announcements/[announcementId]">) {
  const { workspaceSlug, announcementId } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "GUEST");
  const announcement = await getAnnouncement(ctx, announcementId);
  if (!announcement) notFound();
  const tz = ctx.workspace.timezone;
  const base = `/w/${ctx.workspace.slug}/announcements`;

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Link href={base} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-ink-secondary hover:text-ink">
        <ArrowLeft aria-hidden className="size-4" /> All announcements
      </Link>
      <PageHeader
        kicker={
          <span className="flex flex-wrap items-center gap-2">
            {announcement.pinned ? <Chip tone="highlight" size="sm">Pinned</Chip> : null}
            {announcement.status === "scheduled" ? <Chip tone="info" size="sm">Scheduled · {formatDayTime(announcement.publishedAt!, tz)} {formatTimeZoneName(announcement.publishedAt!, tz)}</Chip> : null}
            {announcement.status === "draft" ? <Chip tone="outline" size="sm">Draft</Chip> : null}
          </span>
        }
        title={announcement.title}
        actions={
          canManageAnnouncements(ctx.membership) ? (
            <AnnouncementActions slug={ctx.workspace.slug} id={announcement.id} title={announcement.title} pinned={announcement.pinned} afterDelete={base} />
          ) : null
        }
      />
      <p className="flex items-center gap-2.5 text-body-ui text-ink-muted">
        <Avatar name={announcement.author?.name ?? "Former member"} src={announcement.author?.image} size="sm" />
        <span>
          {announcement.author?.name ?? "Former member"}
          {announcement.publishedAt && announcement.status === "published" ? ` · ${formatDate(announcement.publishedAt, tz)}` : ""}
        </span>
      </p>
      {/* Sanitised on save and again when read (lib/community/richText.ts). */}
      <div className="yy-prose rounded-xl border border-line bg-panel p-5 sm:p-8" dangerouslySetInnerHTML={{ __html: announcement.body }} />
    </article>
  );
}
