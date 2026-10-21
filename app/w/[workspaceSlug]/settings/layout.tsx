import { SettingsLayout as SettingsPageLayout } from "@/components/ui/layouts";
import { PageHeader } from "@/components/ui/display";
import { SettingsTabs } from "@/components/settings/SettingsTabs";
import { requireWorkspace } from "@/lib/permissions";

export default async function SettingsLayout({ children, params }: LayoutProps<"/w/[workspaceSlug]/settings">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  return (
    <SettingsPageLayout header={<PageHeader title="Settings" description={`How ${workspace.name} runs: details, people, labels and the record of changes.`} />} tabs={<SettingsTabs slug={workspace.slug} />}>
      {children}
    </SettingsPageLayout>
  );
}
