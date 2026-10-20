// Generated from app/w/[workspaceSlug]/app-reviews/insights/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { formatDate } from "@/lib/format/datetime";
import { requireWorkspace } from "@/lib/permissions";
import { canManageAppReviews } from "@/lib/roles";
import { reviewInsights } from "@/lib/appReviews/queries";

export async function loadAppReviewInsightsPage({ params }: PageProps<"/w/[workspaceSlug]/app-reviews/insights">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const data = await reviewInsights(ctx);
if (!data) return null;
const { summary: s, daily, distribution, volumes } = data;
const manage = canManageAppReviews(ctx.membership);
const dayLabel = (day: string) => formatDate(`${day}T00:00:00Z`, "UTC");
const points = daily.map((d, i) => `${30 + (i * 540) / Math.max(1, daily.length - 1)},${180 - d.average * 30}`).join(" ");
return viewDto({ ctx, s, daily, distribution, volumes, manage, points } as const);
}
