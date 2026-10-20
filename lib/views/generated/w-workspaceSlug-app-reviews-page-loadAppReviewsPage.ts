// Generated from app/w/[workspaceSlug]/app-reviews/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { canManageAppReviews } from "@/lib/roles";
import { listReviews, reviewMembers } from "@/lib/appReviews/queries";

export async function loadAppReviewsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/app-reviews">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const raw = Object.fromEntries(Object.entries(await searchParams).filter(([, v]) => typeof v === "string" && v !== ""));
const [data, members] = await Promise.all([listReviews(ctx, raw), reviewMembers(ctx)]);
const manage = canManageAppReviews(ctx.membership);
return viewDto({ ctx, raw, data, members, manage } as const);
}
