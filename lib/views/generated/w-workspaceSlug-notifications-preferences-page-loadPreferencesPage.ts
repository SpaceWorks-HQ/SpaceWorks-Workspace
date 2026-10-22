// Generated from app/w/[workspaceSlug]/notifications/preferences/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { NOTIFY_CATEGORIES, type NotifyCategory } from "@/lib/notify/events";
import { resolvePersonalChannels } from "@/lib/notify/preferences";

export async function loadPreferencesPage({
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
return viewDto({ workspace, membership, settings, mutes, linked, rows } as const);
}
