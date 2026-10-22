import Link from "next/link";
import { PageHeader, Card } from "@/components/ui/display";
import { requireWorkspace } from "@/lib/permissions";
import { listActivity } from "@/lib/search/query";
import { searchActor } from "@/lib/shell/context";
import { formatRelativeTime } from "@/lib/format/datetime";
export const metadata = { title: "Activity" };
export default async function ActivityPage({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/activity">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug);
  const query = await searchParams;
  const raw =
    typeof query.before === "string" ? new Date(query.before) : undefined;
  const before = raw && !isNaN(raw.getTime()) ? raw : undefined;
  const type =
    typeof query.type === "string" ? query.type.slice(0, 40) : undefined;
  const rows = await listActivity(searchActor(ctx), before, type);
  const base = `/w/${workspaceSlug}/activity`;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Activity"
        description="The latest changes you can access, across the crew’s work."
      />
      <nav aria-label="Activity type" className="flex flex-wrap gap-3">
        {[
          "",
          "task",
          "doc",
          "channel",
          "link",
          "announcement",
        ].map((t) => (
          <Link
            key={t}
            className="inline-flex min-h-11 items-center px-2 underline"
            aria-current={t === (type ?? "") ? "page" : undefined}
            href={`${base}${t ? `?type=${t}` : ""}`}
          >
            {t.replaceAll("_", " ") || "All"}
          </Link>
        ))}
      </nav>
      <Card>
        {rows.length ? (
          <ol className="divide-y divide-line">
            {rows.map((row) => (
              <li key={row.id} className="py-4">
                <p className="break-words text-body-ui">{row.summary}</p>
                <time
                  dateTime={row.createdAt.toISOString()}
                  className="text-caption text-ink-muted"
                >
                  {formatRelativeTime(row.createdAt, ctx.workspace.timezone)}
                </time>
              </li>
            ))}
          </ol>
        ) : (
          <p>
            No activity here yet.{" "}
            <Link className="underline" href={`/w/${workspaceSlug}`}>
              Back to my day
            </Link>
          </p>
        )}
      </Card>
      {rows.length === 40 ? (
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`${base}?before=${rows.at(-1)!.createdAt.toISOString()}${type ? `&type=${encodeURIComponent(type)}` : ""}`}
        >
          Earlier activity
        </Link>
      ) : null}
    </div>
  );
}
