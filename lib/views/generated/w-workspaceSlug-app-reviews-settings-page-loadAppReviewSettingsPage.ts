// Generated from app/w/[workspaceSlug]/app-reviews/settings/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { reviewSettings } from "@/lib/appReviews/queries";

export async function loadAppReviewSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/app-reviews/settings">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "ADMIN");
const data = await reviewSettings(ctx);
if (!data) return null;
const eventUrl = new URL(`/api/app-reviews/slack/events?workspace=${encodeURIComponent(workspaceSlug)}`, process.env.BACKEND_ORIGIN ?? process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3230").toString();
return viewDto({ ctx, data, eventUrl } as const);
}
