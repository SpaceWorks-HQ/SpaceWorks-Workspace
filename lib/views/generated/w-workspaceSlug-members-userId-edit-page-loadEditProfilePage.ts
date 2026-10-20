// Generated from app/w/[workspaceSlug]/members/[userId]/edit/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { memberProfile } from "@/lib/people/profiles";
import { canActOnMember } from "@/lib/roles";

export async function loadEditProfilePage({ params }: PageProps<"/w/[workspaceSlug]/members/[userId]/edit">) {
const { workspaceSlug, userId } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const member = await memberProfile(ctx, userId);
if (!member) notFound();
const self = ctx.user.id === userId;
if (!self && !canActOnMember(ctx.membership, member.role)) notFound();
return viewDto({ ctx, member, self } as const);
}
