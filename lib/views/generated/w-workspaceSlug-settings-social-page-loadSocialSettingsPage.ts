// Generated from app/w/[workspaceSlug]/settings/social/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { socialAccounts, connectionDraft } from "@/lib/social/queries";

export async function loadSocialSettingsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/settings/social">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "ADMIN");
const query = await searchParams;
const [accounts, draft, logs] = await Promise.all([socialAccounts(ctx), typeof query.draft === "string" ? connectionDraft(ctx, query.draft) : null, prisma.socialSyncLog.findMany({ where: { workspaceId: ctx.workspace.id }, orderBy: { startedAt: "desc" }, take: 10, include: { account: { select: { displayName: true } } } })]);
return viewDto({ ctx, accounts, draft, logs } as const);
}
