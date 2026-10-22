import Link from "next/link";
import { Card, CardHeader, Chip, PageHeader } from "@/components/ui/display";
import { ExportForm, JobRefresh } from "@/components/importer/SettingsForms";
import { requireWorkspace } from "@/lib/permissions";
import { canManageWorkspace } from "@/lib/roles";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatDayTime } from "@/lib/format/datetime";
export const metadata = { title: "Workspace export" };
export default async function ExportPage({
  params,
}: PageProps<"/w/[workspaceSlug]/settings/export">) {
  const { workspaceSlug } = await params;
  const context = await requireWorkspace(workspaceSlug, "ADMIN");
  const { workspace, membership } = context;
  if (!canManageWorkspace(membership)) notFound();
  const jobs = await prisma.exportJob.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return (
    <div className="flex flex-col gap-5">
      <PageHeader titleAs="h2"
        title="Workspace export"
        description="Download a portable JSON bundle of your workspace records."
      />
      <nav aria-label="Data settings" className="flex flex-wrap gap-3">
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`/w/${workspaceSlug}/settings/import`}
        >
          CSV import
        </Link>
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`/w/${workspaceSlug}/settings/retention`}
        >
          Retention and locale
        </Link>
      </nav>
      <Card>
        <CardHeader
          title="Request an export"
          description="Secrets, vault contents, emergency contacts, identities, private conversations and file binaries are excluded. Downloads expire after seven days."
        />
        <ExportForm slug={workspaceSlug} />
      </Card>
      <JobRefresh
        pending={jobs.some(
          (j) => j.status === "QUEUED" || j.status === "RUNNING",
        )}
      />
      <Card>
        <CardHeader title="Recent exports" />
        {jobs.length ? (
          <ul className="divide-y divide-line">
            {jobs.map((j) => (
              <li
                className="flex flex-wrap items-center justify-between gap-3 py-4"
                key={j.id}
              >
                <div>
                  <p>{formatDayTime(j.createdAt, workspace.timezone)}</p>
                  {j.error ? (
                    <p className="text-caption text-danger-fg">{j.error}</p>
                  ) : null}
                </div>
                <Chip
                  tone={
                    j.status === "FAILED"
                      ? "danger"
                      : j.status === "SUCCEEDED"
                        ? "success"
                        : "neutral"
                  }
                >
                  {j.status.toLowerCase()}
                </Chip>
                {j.status === "SUCCEEDED" &&
                j.storageKey &&
                j.expiresAt &&
                j.expiresAt > new Date() ? (
                  <a
                    className="inline-flex min-h-11 items-center underline"
                    href={`/w/${workspaceSlug}/settings/export/${j.id}`}
                  >
                    Download {j.format === "JSON" ? "JSON" : "ZIP"}
                  </a>
                ) : j.status === "SUCCEEDED" ? (
                  <span className="text-caption text-ink-muted">Expired</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>No exports yet. Request one above.</p>
        )}
      </Card>
    </div>
  );
}
