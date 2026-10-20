// Generated from app/w/[workspaceSlug]/onboarding/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { requireWorkspace } from "@/lib/permissions";
import { canManageOnboarding } from "@/lib/roles";
import { checklistRuns, checklistTemplates } from "@/lib/people/onboarding";
import { listMembers } from "@/lib/people/profiles";

export async function loadOnboardingPage({ params }: PageProps<"/w/[workspaceSlug]/onboarding">) {
const { workspaceSlug } = await params;
const ctx = await requireWorkspace(workspaceSlug, "GUEST");
const manage = canManageOnboarding(ctx.membership);
const [runs, templates, members] = await Promise.all([checklistRuns(ctx), checklistTemplates(ctx), manage ? listMembers(ctx) : Promise.resolve([])]);
return viewDto({ ctx, manage, runs, templates, members } as const);
}
