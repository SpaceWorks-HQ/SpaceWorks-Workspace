import { auth } from "@/lib/auth";
import { findWorkspaceForUser } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  drillRecords,
  loadMetrics,
  listPresets,
} from "@/lib/analytics/queries";
import { cashForecast, forecastDrill } from "@/lib/analytics/forecast";
import { adjustmentList } from "@/lib/analytics/service";
import { csv, queryString } from "@/lib/analytics/metrics";
import { recordAuditEvent } from "@/lib/audit";
export async function GET(
  request: Request,
  { params }: RouteContext<"/w/[workspaceSlug]/analytics/export">,
) {
  const { workspaceSlug } = await params,
    session = await auth();
  if (!session?.user?.id) return new Response("Not found", { status: 404 });
  const context = await findWorkspaceForUser(workspaceSlug, session.user.id);
  if (!context) return new Response("Not found", { status: 404 });
  if (await isActionRateLimited("action", session.user.id))
    return new Response("Try again shortly.", { status: 429 });
  const actor = { ...context, user: { id: session.user.id } },
    search = new URL(request.url).searchParams,
    q = Object.fromEntries(search);
  let rows: unknown[][];
  try {
    if (search.get("kind") === "adjustments") {
      const data = await adjustmentList(
        actor,
        q.currency ?? context.workspace.currency,
      );
      rows = [
        [
          "Date",
          "Title",
          "Amount minor units",
          "Currency",
          "Notes",
          "Proof links",
        ],
        ...data.map((r) => [
          r.dueOn,
          r.title,
          r.amountMinor,
          r.currency,
          r.notes,
          r.files.map((f) => `/api/files/${f.id}`).join(" "),
        ]),
      ];
    } else if (search.get("kind") === "presets") {
      const data = await listPresets(actor);
      rows = [
        [
          "Name",
          "Section",
          "Filters",
          "Pinned",
          "Shared with admins",
          "Commentary",
        ],
        ...data.map((r) => [
          r.name,
          r.section,
          queryString(r.query),
          r.pinned,
          r.shared,
          r.commentary,
        ]),
      ];
    } else if (search.get("metric") === "forecast") {
      const r = await forecastDrill(actor, { ...q, page: "1" }, 10000);
      rows = [
        ["From", r.period.from, "To", r.period.to],
        ["Date", "Record", "Source", "Amount minor units", "Currency", "Link"],
        ...r.rows.map((l) => [
          l.date,
          l.title,
          l.label,
          l.value,
          r.q.currency,
          l.path,
        ]),
      ];
    } else if (search.get("kind") === "forecast") {
      const f = await cashForecast(actor, q);
      rows = [
        ["Cash forecast", f.asOf, f.currency],
        ["Opening balance minor units", f.openingMinor],
        [
          "Weekly forecast",
          "Income minor units",
          "Expense minor units",
          "Closing minor units",
          "Below threshold",
        ],
        ...f.weekly.map((b) => [
          b.label,
          b.incomeMinor,
          b.expenseMinor,
          b.closingMinor,
          f.openingKnown ? b.low : "Not assessed",
        ]),
        [
          "Monthly forecast",
          "Income minor units",
          "Expense minor units",
          "Closing minor units",
          "Below threshold",
        ],
        ...f.monthly.map((b) => [
          b.label,
          b.incomeMinor,
          b.expenseMinor,
          b.closingMinor,
          f.openingKnown ? b.low : "Not assessed",
        ]),
        [
          "Date",
          "Record",
          "Source",
          "Amount minor units",
          "Currency",
          "Estimate",
          "Link",
        ],
        ...f.lines.map((l) => [
          l.date,
          l.title,
          l.source,
          l.amountMinor,
          f.currency,
          l.estimated,
          l.path,
        ]),
      ];
    } else if (search.has("metric")) {
      const r = await drillRecords(
        actor,
        search.get("metric")!,
        { ...q, page: "1" },
        10000,
      );
      if (r.more)
        return new Response(
          "Narrow the period to export up to 10,000 records.",
          { status: 400 },
        );
      rows = [
        ["Metric", r.title],
        ["From", r.period.from, "To", r.period.to, "Currency", r.q.currency],
        [
          "ID",
          "Date",
          "Record",
          "Group",
          "Value",
          "Denominator",
          "Unit",
          "Link",
        ],
        ...r.rows.map((f) => [
          f.id,
          f.date,
          f.title,
          f.label,
          f.value,
          f.base,
          r.basisUnit === "money" ? "minor units" : r.basisUnit,
          f.path,
        ]),
      ];
    } else {
      const r = await loadMetrics(actor, q);
      rows = [
        ["From", r.period.from, "To", r.period.to, "Currency", r.q.currency],
        [
          "Metric",
          "Group",
          "Value",
          "Unit",
          "Records",
          "Previous",
          "Last year",
        ],
        ...r.metrics.flatMap((m) =>
          m.groups.map((p) => [
            m.title,
            p.label,
            p.value,
            m.id === "win-rate"
              ? "count"
              : m.unit === "money"
                ? "minor units"
                : m.unit,
            p.count,
            p.previous,
            p.lastYear,
          ]),
        ),
      ];
    }
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "analytics.csv_exported",
      targetType: "analytics",
      targetId: search.get("metric") ?? "overview",
    });
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="space-works-analytics.csv"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(
      "That report is unavailable. Check the period and your access.",
      { status: 404 },
    );
  }
}
