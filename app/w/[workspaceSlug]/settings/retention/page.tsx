import { Card, CardHeader, PageHeader, Callout } from "@/components/ui/display";
import {
  RetentionForm,
  ShellSettingsForm,
} from "@/components/importer/SettingsForms";
import { RETENTION_AREAS } from "@/lib/shell/retention";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
export const metadata = { title: "Retention and locale" };
export default async function RetentionPage({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/retention">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  const policies = await prisma.retentionPolicy.findMany({
    where: { workspaceId: workspace.id },
  });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Retention and locale"
        description="Choose how long platform records stay in this workspace."
      />
      {workspace.legalHold ? (
        <Callout tone="warning" title="Legal hold is active">
          Platform retention purges and export object cleanup are paused.
        </Callout>
      ) : null}
      <Card>
        <CardHeader title="Workspace settings" />
        <ShellSettingsForm
          slug={workspaceSlug}
          locale={workspace.defaultLocale}
          legalHold={workspace.legalHold}
        />
      </Card>
      <Card>
        <CardHeader
          title="Retention policies"
          description="The scheduled worker removes old content. Blank uses the defaults for inbound events (14 days), completed outbox jobs (30 days, or the instance setting) and monitor results (the services setting). Other areas keep records indefinitely without a policy. Audit records are kept unless you set a policy."
        />
        {Object.entries(RETENTION_AREAS).map(([area, label]) => (
          <RetentionForm
            key={area}
            slug={workspaceSlug}
            area={area}
            label={label}
            days={policies.find((p) => p.entityType === area)?.keepDays ?? null}
          />
        ))}
      </Card>
    </div>
  );
}
