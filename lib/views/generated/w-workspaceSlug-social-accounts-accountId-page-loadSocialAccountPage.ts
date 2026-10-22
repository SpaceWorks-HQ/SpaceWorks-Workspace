// Generated from app/w/[workspaceSlug]/social/accounts/[accountId]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireWorkspace } from "@/lib/permissions";
import { filterSchema, socialOverview } from "@/lib/social/queries";

export async function loadSocialAccountPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/social/accounts/[accountId]">) {
const { workspaceSlug, accountId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const raw = await searchParams;
const f = filterSchema.parse({ ...Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string" && v !== "")), account: accountId });
const data = await socialOverview(ctx, f);
const account = data?.accounts[0];
if (!account || !data) notFound();
const sorts = ["publishedAt", "likes", "comments", "shares", "views", "reach"] as const;
const sort = sorts.find(v => v === raw.sort) ?? "publishedAt";
const where = { workspaceId: ctx.workspace.id, accountId };
const [posts, total] = await Promise.all([prisma.socialPost.findMany({ where, orderBy: sort === "publishedAt" ? { publishedAt: "desc" } : { [sort]: { sort: "desc", nulls: "last" } }, take: 50, skip: (f.page - 1) * 50 }), prisma.socialPost.count({ where })]);
return viewDto({ ctx, f, data, account, sorts, sort, posts, total } as const);
}
