import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import { FinanceError } from "@/lib/finance/tools/access";
import {
  advancesView,
  allSchedules,
  upcomingView,
  scheduleCsvRow,
  iso,
} from "@/lib/finance/recurring/queries";
import { csv } from "@/lib/finance/recurring/rules";
import { recordAuditEvent } from "@/lib/audit";
export async function GET(
  request: Request,
  { params }: RouteContext<"/w/[workspaceSlug]/finance/recurring/export">,
) {
  const { workspaceSlug } = await params,
    actor = await getWorkspaceForAction(workspaceSlug, "MEMBER");
  const headers = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (!actor) return new Response("Not found", { status: 404, headers });
  if (await isActionRateLimited("apiRead", `recurring-export:${actor.user.id}`))
    return new Response("Try again in a minute.", { status: 429, headers });
  try {
    const q = Object.fromEntries(new URL(request.url).searchParams);
    let rows: unknown[][];
    if (q.export === "advances") {
      const view = await advancesView(actor, q, true);
      rows = [
        [
          "Person id",
          "Reason",
          "Currency",
          "Advance minor",
          "Paid on",
          "Status",
          "Instalment",
          "Due on",
          "Due minor",
          "Recovered minor",
          "Outstanding minor",
          "Proof file ids",
        ],
        ...view.rows.flatMap((a) =>
          (a.recoveries.length ? a.recoveries : [null]).map((r) => [
            a.userId,
            a.reason,
            a.currency,
            a.amountMinor,
            iso(a.paidOn),
            a.status,
            r?.instalment,
            r ? iso(r.dueOn) : "",
            r?.amountMinor,
            r?.recoveredMinor,
            r ? r.amountMinor - r.recoveredMinor : a.amountMinor,
            (view.files[a.id] ?? []).map((f) => f.id).join(";"),
          ]),
        ),
      ];
    } else if (q.export === "dues" || q.export === "payroll") {
      const view = await upcomingView(actor, q, q.export === "payroll");
      rows = [
        [
          "Title",
          "Type",
          "Due on",
          "Currency",
          "Amount minor",
          "Paid minor",
          "Outstanding minor",
          "Fund",
          "Cost centre",
          "Needs actual",
          "Projected",
          "Paid on",
          "Reference",
          "Bill id",
        ],
        ...view.all.map((r) => [
          r.title,
          r.kind,
          r.dueOn,
          r.currency,
          r.amountMinor,
          r.paidMinor,
          r.amountMinor - r.paidMinor,
          r.fundId,
          r.costCentreId,
          r.needsActual,
          r.projected,
          r.paidOn,
          r.reference,
          r.billId,
        ]),
      ];
    } else {
      const schedules = await allSchedules(actor, q);
      if (schedules.length > 10000)
        throw new FinanceError(
          "Narrow the export to at most 10,000 schedules.",
        );
      rows = [
        [
          "Title",
          "Type",
          "Payee",
          "Status",
          "Currency",
          "Base amount minor",
          "Amount mode",
          "Frequency",
          "Monthly base equivalent minor",
          "Next due",
          "Fund",
          "Cost centre",
          "GST percent",
          "TDS section",
          "TDS percent",
          "Notes",
        ],
        ...schedules.map(scheduleCsvRow),
      ];
    }
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "finance.recurring_exported",
      targetType: q.export ?? "schedules",
    });
    return new Response(`\uFEFF${csv(rows)}`, {
      headers: {
        ...headers,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=recurring-costs.csv",
      },
    });
  } catch (e) {
    if (e instanceof FinanceError)
      return new Response(
        "Those records are unavailable or the export is too large.",
        { status: 404, headers },
      );
    throw e;
  }
}
