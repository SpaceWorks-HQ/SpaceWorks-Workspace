// Generated from app/w/[workspaceSlug]/links/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { searchActor } from "@/lib/shell/context";
import { listLinks } from "@/lib/shell/links";
import { listSavedViews } from "@/lib/shell/views";

export async function loadLinksPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/links">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug);
const query = await searchParams;
const q = typeof query.q === "string" ? query.q.slice(0, 200) : "";
const tag = typeof query.tag === "string" ? query.tag.slice(0, 40) : "";
const [links, bookmarks, views] = await Promise.all([
    listLinks(searchActor(ctx), tag, q),
    prisma.bookmark.findMany({
      where: {
        workspaceId: ctx.workspace.id,
        userId: ctx.user.id,
        entityType: "link",
      },
      select: { entityId: true },
    }),
    listSavedViews(searchActor(ctx), "link"),
  ]);
const base = `/w/${workspaceSlug}/links`;
return viewDto({ ctx, q, tag, links, bookmarks, views, base } as const);
}
