import { PageHeader } from "@/components/ui/display";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { requireWorkspace } from "@/lib/permissions";

export default async function SettingsLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/settings">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description={`How ${workspace.name} runs: details, people, labels and the record of changes.`} />
      <SettingsTabs slug={workspace.slug} />
      <div>{children}</div>
    </div>
  );
}
