// Generated from app/w/[workspaceSlug]/settings/onboarding/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canManageOnboarding } from "@/lib/roles";
import { checklistTemplates } from "@/lib/people/onboarding";
import { listTeams } from "@/lib/teams/teams";
import { listMembers } from "@/lib/people/profiles";

export async function loadTemplatesPage({ params }: PageProps<"/w/[workspaceSlug]/settings/onboarding">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "ADMIN");
if (!canManageOnboarding(ctx.membership)) notFound();
const [templates, teams, members] = await Promise.all([checklistTemplates(ctx), listTeams(ctx), listMembers(ctx)]);
return viewDto({ templates, teams, members } as const);
}
