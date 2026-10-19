import Link from "next/link";
import {
  Card,
  CardHeader,
  PageHeader,
  Chip,
  Callout,
} from "@/components/ui/display";
import { requireSuperAdminMfa } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { formatDayTime } from "@/lib/format/datetime";
export const metadata = { title: "Backups posture" };
export default async function BackupsPage() {
  await requireSuperAdminMfa();
  const rows = await prisma.backupRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 50,
  });
  const staleBefore = new Date().getTime() - 48 * 3600000;
  const latest = ["DB", "FILES"].map((kind) => ({
    kind,
    row: rows.find((r) => r.kind === kind && r.status === "SUCCEEDED"),
  }));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Backups posture"
        description="Reported database and file backups. A recorded success does not replace a restore drill."
      />
      <Link
        className="inline-flex min-h-11 items-center underline"
        href="/admin/sso"
      >
        Single sign-on
      </Link>
      {latest.some((x) => !x.row || x.row.startedAt.getTime() < staleBefore) ? (
        <Callout tone="warning" title="Backup evidence needs attention">
          A database or files backup has no success reported in the last 48
          hours. Check the operator’s backup schedule and reporting.
        </Callout>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {latest.map(({ kind, row }) => (
          <Card key={kind}>
            <CardHeader title={kind === "DB" ? "Database" : "Files"} />
            <Chip tone={row ? "success" : "warning"}>
              {row ? "Success reported" : "No evidence"}
            </Chip>
            <p className="mt-3 text-caption">
              {row
                ? formatDayTime(row.startedAt, "UTC")
                : "No successful run recorded."}{" "}
              · UTC
            </p>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader
          title="Recent runs"
          description="Storage locations and raw errors stay out of this view to protect operator credentials."
        />
        {rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <span>
                  {r.kind} · {formatDayTime(r.startedAt, "UTC")} UTC
                </span>
                <Chip tone={r.status === "FAILED" ? "danger" : "neutral"}>
                  {r.status.toLowerCase()}
                </Chip>
                <span className="text-caption">
                  {r.sizeBytes !== null
                    ? `${Number(r.sizeBytes / BigInt(1024))} KB`
                    : "Size not reported"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>
            No backup runs reported. Ask the operator to connect backup
            reporting.
          </p>
        )}
      </Card>
    </div>
  );
}
