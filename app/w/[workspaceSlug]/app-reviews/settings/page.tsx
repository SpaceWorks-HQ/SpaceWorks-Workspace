import { requireWorkspace } from "@/lib/permissions";
import { reviewSettings } from "@/lib/appReviews/queries";
import { ReviewNav } from "@/components/appReviews/ReviewNav";
import { ReviewSettings } from "@/components/appReviews/ReviewSettings";

export default async function AppReviewSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/app-reviews/settings">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "ADMIN");
  const data = await reviewSettings(ctx);
  if (!data) return null;
  const eventUrl = new URL(`/api/app-reviews/slack/events?workspace=${encodeURIComponent(workspaceSlug)}`, process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3230").toString();
  return <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]"><ReviewNav slug={workspaceSlug} active="settings" manage /><ReviewSettings slug={workspaceSlug} data={data} timezone={ctx.workspace.timezone} eventUrl={eventUrl} /></div>;
}
