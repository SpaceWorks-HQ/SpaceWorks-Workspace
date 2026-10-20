// Generated from app/status/[workspaceSlug]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { publicSummary } from "@/lib/monitor/public";

export async function loadgenerateMetadata({ params }: PageProps<"/status/[workspaceSlug]">) {
const summary = await publicSummary((await params).workspaceSlug);
return { title: summary?.title ?? "Service status", robots: summary?.noindex !== false ? { index: false, follow: false } : undefined };

}
