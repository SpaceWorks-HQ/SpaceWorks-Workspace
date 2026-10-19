import Link from "next/link";
import { importSummary } from "@/lib/shell/importSummary";
import { Card, CardHeader, PageHeader, Chip } from "@/components/ui/display";
import { CsvImporter } from "@/components/importer/CsvImporter";
import { JobRefresh } from "@/components/importer/SettingsForms";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatDayTime } from "@/lib/format/datetime";
export const metadata = { title: "CSV import" };
export default async function ImportPage({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/import">) {
  const { workspaceSlug } = await params;
  const { workspace } = await requireWorkspace(workspaceSlug, "ADMIN");
  const jobs = await prisma.importJob.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="CSV import"
        description="Preview, map and import links for the crew."
      />
      <Link
        className="inline-flex min-h-11 items-center underline"
        href={`/w/${workspaceSlug}/settings/export`}
      >
        Workspace exports
      </Link>
      <Card>
        <CardHeader
          title="Import links"
          description="Choose a CSV, map its columns and preview the first records before importing."
        />
        <CsvImporter slug={workspaceSlug} />
      </Card>
      <JobRefresh
        pending={jobs.some(
          (j) => j.status === "QUEUED" || j.status === "RUNNING",
        )}
      />
      <Card>
        <CardHeader title="Import history" />
        {jobs.length ? (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li key={j.id} className="py-4">
                <p className="flex flex-wrap items-center gap-3">
                  {formatDayTime(j.createdAt, workspace.timezone)}
                  <Chip tone={j.status === "FAILED" ? "danger" : "neutral"}>
                    {j.status.toLowerCase()}
                  </Chip>
                  {j.dryRun ? "Preview only" : "Import"}
                </p>
                {j.stats ? (
                  <div className="mt-3 text-body-ui">
                    <p>
                      {importSummary(j.stats).total} rows ·{" "}
                      {importSummary(j.stats).valid} valid ·{" "}
                      {importSummary(j.stats).created} links created ·{" "}
                      {importSummary(j.stats).skipped} existing links skipped
                    </p>
                    <ul className="mt-2 text-danger-fg">
                      {importSummary(j.stats).errors.map((error, index) => (
                        <li key={index}>
                          {error.row ? `Row ${error.row}: ` : ""}
                          {error.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>No imports yet. Preview a CSV above.</p>
        )}
      </Card>
    </div>
  );
}
