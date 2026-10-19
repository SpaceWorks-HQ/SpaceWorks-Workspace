import Link from "next/link";
import { PageHeader } from "@/components/ui/display";
import { Preferences } from "@/components/notification-center/Preferences";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { NOTIFY_CATEGORIES, type NotifyCategory } from "@/lib/notify/events";
import {
  availablePersonalChannels,
  resolvePersonalChannels,
} from "@/lib/notify/preferences";
import { parseQuietHours } from "@/lib/notify/quietHours";
export const metadata = { title: "Notification preferences" };
export default async function PreferencesPage({
  params,
}: PageProps<"/w/[workspaceSlug]/notifications/preferences">) {
  const { workspaceSlug } = await params;
  const { user, workspace, membership } = await requireWorkspace(workspaceSlug);
  const [preferences, settings, links, mutes] = await Promise.all([
    prisma.notificationPreference.findMany({
      where: {
        workspaceId: workspace.id,
        OR: [{ userId: user.id }, { userId: null }],
      },
    }),
    prisma.notificationUserSettings.findUnique({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
    }),
    prisma.externalIdentityLink.findMany({
      where: {
        workspaceId: workspace.id,
        userId: user.id,
        verifiedAt: { lte: new Date() },
        connection: { workspaceId: workspace.id, status: "ACTIVE" },
      },
      select: { provider: true },
    }),
    prisma.notificationMute.findMany({
      where: {
        workspaceId: workspace.id,
        userId: user.id,
        OR: [{ until: null }, { until: { gt: new Date() } }],
      },
      select: { id: true, resourceType: true, resourceId: true },
    }),
  ]);
  const linked = links.map((l) => l.provider);
  const rows = (Object.keys(NOTIFY_CATEGORIES) as NotifyCategory[]).map(
    (category) => ({
      category,
      ...resolvePersonalChannels({
        category,
        role: membership.role,
        linkedProviders: linked,
        userPreference: preferences.find(
          (p) => p.category === category && p.userId === user.id,
        ),
        workspaceDefault: preferences.find(
          (p) => p.category === category && p.userId === null,
        ),
      }),
    }),
  );
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Notification preferences"
        description="Choose where updates reach you, and when."
      />
      <Link
        className="inline-flex min-h-11 items-center underline"
        href={`/w/${workspaceSlug}/notifications`}
      >
        Back to notifications
      </Link>
      <Preferences
        slug={workspaceSlug}
        available={[...availablePersonalChannels(membership.role, linked)]}
        rows={rows}
        quiet={parseQuietHours(settings?.quietHours)}
        critical={settings?.criticalBypassesQuiet ?? true}
        snoozedUntil={settings?.snoozedUntil?.toISOString() ?? null}
        mutes={mutes}
        tz={workspace.timezone}
      />
    </div>
  );
}
