import { notFound } from "next/navigation";
import { EmptyState } from "@/components/ui/display";
import { canManageOnboarding, requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Onboarding templates" };

/** Placeholder: replaced by the people-relationships build (see docs/ROADMAP-BUILD.md). */
export default async function OnboardingSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings/onboarding">) {
  const { workspaceSlug } = await params;
  const { membership } = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canManageOnboarding(membership)) notFound();
  return (
    <EmptyState mood="thinking" title="Coming in the next build.">
      Checklists that start when someone joins or leaves, including access to revoke.
    </EmptyState>
  );
}
