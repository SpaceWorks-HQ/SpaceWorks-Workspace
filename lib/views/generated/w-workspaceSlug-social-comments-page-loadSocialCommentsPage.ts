// Generated from app/w/[workspaceSlug]/social/comments/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { filterSchema, listSocialComments, socialAccounts } from "@/lib/social/queries";

export async function loadSocialCommentsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/social/comments">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const raw = Object.fromEntries(Object.entries(await searchParams).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;
const f = filterSchema.parse(raw);
const [data, accounts, members] = await Promise.all([listSocialComments(ctx, f), socialAccounts(ctx), prisma.membership.findMany({ where: { workspaceId: ctx.workspace.id, status: "ACTIVE", role: { in: ["OWNER", "ADMIN", "MEMBER"] }, user: { disabledAt: null } }, select: { userId: true, user: { select: { name: true } } } })]);
if (!data) return null;
const pageHref = (page: number) => `?${new URLSearchParams({ ...raw, page: String(page) })}`;
return viewDto({ ctx, raw, f, data, accounts, members } as const);
}
