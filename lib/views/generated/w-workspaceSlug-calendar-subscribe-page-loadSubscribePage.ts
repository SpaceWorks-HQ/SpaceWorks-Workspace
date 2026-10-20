// Generated from app/w/[workspaceSlug]/calendar/subscribe/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { formatDate } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { listFeeds } from "@/lib/community/feeds";

export async function loadSubscribePage({ params }: PageProps<"/w/[workspaceSlug]/calendar/subscribe">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const feeds = await listFeeds(ctx);
const tz = ctx.workspace.timezone;
const since = (scope: "PERSONAL") => {
    const at = feeds.get(scope);
    return at ? formatDate(at, tz) : null;
  };
return viewDto({ ctx, feeds, tz } as const);
}
