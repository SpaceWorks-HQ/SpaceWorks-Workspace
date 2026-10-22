// Generated from app/w/[workspaceSlug]/rota/certifications/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canUseRota, canManageRota } from "@/lib/roles";
import { certifications } from "@/lib/people/certifications";
import { prisma } from "@/lib/db";
import { listMembers } from "@/lib/people/profiles";
import { listTeams } from "@/lib/teams/teams";

export async function loadCertificationsPage({ params }: PageProps<"/w/[workspaceSlug]/rota/certifications">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
if (!canUseRota(ctx.membership)) notFound();
const [certs, types, members, teams] = await Promise.all([certifications(ctx), prisma.certType.findMany({ where: { workspaceId: ctx.workspace.id } }), listMembers(ctx), listTeams(ctx)]);
const trainable = types.filter(t => canManageRota(ctx.membership) || t.trainerIds.includes(ctx.user.id) || teams.some(team => team.id === t.trainerTeamId && team.myRole));
return viewDto({ ctx, certs, types, members, teams, trainable } as const);
}
