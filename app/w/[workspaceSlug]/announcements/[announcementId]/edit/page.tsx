import { notFound } from "next/navigation";
import { AnnouncementForm } from "@/components/community/AnnouncementForm";
import { PageHeader } from "@/components/ui/display";
import { formatTimeZoneName } from "@/lib/format/datetime";
import { canManageNotificationRouting, requireWorkspace } from "@/lib/permissions";
import { zonedDatetimeLocalValue } from "@/lib/timeZone";
import { announcementDestinations, getAnnouncement } from "@/lib/community/announcements";

export const metadata = { title: "Edit announcement" };

export default async function EditAnnouncementPage({ params }: PageProps<"/w/[workspaceSlug]/announcements/[announcementId]/edit">) {
  const { workspaceSlug, announcementId } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "ADMIN");
  const announcement = await getAnnouncement(ctx, announcementId);
  if (!announcement) notFound();
  const { options, selected } = await announcementDestinations(ctx, announcement.id);
  const tz = ctx.workspace.timezone;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Edit announcement"
        description={announcement.status === "published" ? "It's already out. Edits update the page; nothing is sent again." : "Change it before it goes out."}
      />
      <AnnouncementForm
        slug={ctx.workspace.slug}
        announcementId={announcement.id}
        initial={{
          title: announcement.title,
          body: announcement.body,
          pinned: announcement.pinned,
          status: announcement.status,
          scheduledFor: announcement.status === "scheduled" && announcement.publishedAt ? zonedDatetimeLocalValue(announcement.publishedAt, tz) : "",
          destinationIds: selected,
        }}
        destinations={options}
        settingsHref={canManageNotificationRouting(ctx.membership) ? `/w/${ctx.workspace.slug}/settings/notifications` : null}
        timeZoneLabel={`${formatTimeZoneName(new Date(), tz)} (${tz})`}
      />
    </div>
  );
}
