// Generated from app/w/[workspaceSlug]/changelog/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { admin } from "@/lib/meetings/core";
import { listPickableDestinations } from "@/lib/notify/scopedRules";

export async function loadChangelogPage({
  params,
}: PageProps<"/w/[workspaceSlug]/changelog">) {
const { workspaceSlug } = await params;
const actor = await requireWorkspace(workspaceSlug, "GUEST");
const manage = admin(actor);
const [entries, destinations] = await Promise.all([
    prisma.changelogEntry.findMany({
      where: {
        workspaceId: actor.workspace.id,
        ...(manage ? {} : { publishedAt: { not: null } }),
      },
      orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
      take: 200,
    }),
    manage
      ? listPickableDestinations(actor.workspace.id, actor.membership.role)
      : [],
  ]);
return viewDto({ actor, manage, entries, destinations } as const);
}
