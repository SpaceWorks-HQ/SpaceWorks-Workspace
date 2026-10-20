import { GeneralSettingsForm } from "@/components/settings/GeneralSettingsForm";
import { requireWorkspace } from "@/lib/permissions";

export const metadata = { title: "Settings" };

export default async function GeneralSettingsPage({ params }: PageProps<"/w/[workspaceSlug]/settings">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  return (
    <GeneralSettingsForm
      slug={workspace.slug}
      initial={{
        name: workspace.name,
        tagline: workspace.tagline ?? "",
        description: workspace.description ?? "",
        timezone: workspace.timezone,
        currency: workspace.currency,
        financeVisibleToMembers: workspace.financeVisibleToMembers,
      }}
    />
  );
}
