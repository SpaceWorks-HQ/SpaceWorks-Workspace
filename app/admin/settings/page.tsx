import { InstanceSettingsForm } from "@/components/admin/InstanceSettingsForm";
import { PageHeader } from "@/components/ui/display";
import { getInstanceSettingsForDisplay } from "@/lib/instanceSettings";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata = { title: "Instance settings" };

export default async function AdminSettingsPage() {
  await requireSuperAdminMfa();
  const settings = await getInstanceSettingsForDisplay();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Instance settings" description="Saved values override environment variables. Secrets are encrypted and never shown again." />
      <InstanceSettingsForm settings={settings.map(({ key, secret, value, isSet, source }) => ({ key, secret, value, isSet, source }))} />
    </div>
  );
}
