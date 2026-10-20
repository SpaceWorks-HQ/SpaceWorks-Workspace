// Generated from app/w/[workspaceSlug]/app-reviews/[reviewId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getReview, reviewMembers } from "@/lib/appReviews/queries";

export async function loadReviewDetailPage({ params }: PageProps<"/w/[workspaceSlug]/app-reviews/[reviewId]">) {
const { workspaceSlug, reviewId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const [review, members] = await Promise.all([getReview(ctx, reviewId), reviewMembers(ctx)]);
if (!review) notFound();
return viewDto({ ctx, review, members } as const);
}
