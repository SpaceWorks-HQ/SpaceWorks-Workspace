import { AnnouncementForm } from "@/components/community/AnnouncementForm";
import { PageHeader } from "@/components/ui/display";
import { formatTimeZoneName } from "@/lib/format/datetime";
import { canManageNotificationRouting, requireWorkspace } from "@/lib/permissions";
import { announcementDestinations } from "@/lib/community/announcements";

export const metadata = { title: "New announcement" };

export default async function NewAnnouncementPage({ params }: PageProps<"/w/[workspaceSlug]/announcements/new">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "ADMIN");
  const { options } = await announcementDestinations(ctx, null);
  const tz = ctx.workspace.timezone;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="New announcement" description="Tell the crew what's happening. Publish now, schedule it, or keep a draft." />
      <AnnouncementForm
        slug={ctx.workspace.slug}
        announcementId={null}
        initial={{ title: "", body: "", pinned: false, status: "new", scheduledFor: "", destinationIds: [] }}
        destinations={options}
        settingsHref={canManageNotificationRouting(ctx.membership) ? `/w/${ctx.workspace.slug}/settings/notifications` : null}
        timeZoneLabel={`${formatTimeZoneName(new Date(), tz)} (${tz})`}
      />
    </div>
  );
}
