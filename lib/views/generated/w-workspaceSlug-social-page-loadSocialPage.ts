// Generated from app/w/[workspaceSlug]/social/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { canConnectSocial } from "@/lib/roles";
import { filterSchema, socialOverview } from "@/lib/social/queries";

export async function loadSocialPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/social">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
const admin = canConnectSocial(ctx.membership);
const f = filterSchema.parse(Object.fromEntries(Object.entries(await searchParams).filter(([, v]) => typeof v === "string" && v !== "")));
const data = await socialOverview(ctx, f);
if (!data) return null;
const followers = data.followers.filter(v => v.value !== null);
const total = followers.reduce((v, row) => v + row.value!, 0);
return viewDto({ ctx, admin, f, data, followers, total } as const);
}
