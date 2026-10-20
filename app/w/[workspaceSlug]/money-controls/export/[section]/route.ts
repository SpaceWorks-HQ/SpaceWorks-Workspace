import { getWorkspaceForAction } from "@/lib/permissions";
import { isActionRateLimited } from "@/lib/actionRateLimit";
import {
  listControls,
  controlsSummary,
  controlsPickers,
} from "@/lib/moneyControls/queries";
import { csv, querySchema, SECTIONS } from "@/lib/moneyControls/rules";
import { recordAuditEvent } from "@/lib/audit";
import { FinanceError } from "@/lib/finance/tools/access";
export async function GET(
  request: Request,
  {
    params,
  }: RouteContext<"/w/[workspaceSlug]/money-controls/export/[section]">,
) {
  const { workspaceSlug, section } = await params,
    actor = await getWorkspaceForAction(workspaceSlug, "MEMBER");
  if (!actor || !Object.hasOwn(SECTIONS, section))
    return new Response(null, { status: 404 });
  if (
    await isActionRateLimited(
      "apiRead",
      `money-controls-export:${actor.user.id}`,
    )
  )
    return new Response("Try again shortly.", { status: 429 });
  const query = querySchema.safeParse({
    ...Object.fromEntries(new URL(request.url).searchParams),
    section,
  });
  if (!query.success)
    return new Response("Check the export filters.", { status: 400 });
  try {
    const data = await listControls(actor, query.data, true);
    if (data.rows.length > 10000)
      return new Response(
        "Choose a shorter date range, up to 10,000 records.",
        { status: 400 },
      );
    const summary = await controlsSummary(
      actor,
      section,
      data.q.fiscalYear,
      data.q.fundId,
    );
    const p = await controlsPickers(actor);
    const name = (rows: { id: string; name: string }[], id: string | null) =>
      rows.find((r) => r.id === id)?.name ?? id ?? "";
    const rows: unknown[][] = [
      [
        "Type",
        "Title",
        "Status",
        "Date",
        "Due",
        "Owner",
        "Account",
        "Other account",
        "Asset",
        "Fund",
        "Expense category",
        "Amount minor",
        "Currency",
        "Settled minor",
        "Payee",
        "Section",
        "FY start",
        "Quarter",
        "Direction",
        "Official form",
        "Certificate number",
        "Funding source",
        "Method",
        "Notes",
        "Details",
        "File references",
      ],
      ...data.rows.map((r) => {
        const d = (r.details ?? {}) as Record<string, unknown>;
        return [
          r.kind,
          r.title,
          r.status,
          r.occurredOn,
          r.dueOn,
          name(p.members, r.ownerId),
          name(p.accounts, r.accountId),
          name(p.accounts, r.otherAccountId),
          name(p.assets, r.assetId),
          name(p.funds, r.fundId),
          name(p.categories, r.categoryId),
          r.amountMinor,
          r.currency,
          r.settledMinor,
          d.payee,
          d.section,
          d.fiscalYear,
          d.quarter,
          d.direction,
          d.form,
          d.certificateNumber,
          d.fundingSource,
          d.method,
          r.notes,
          JSON.stringify(r.details),
          r.files.map((f) => `${f.filename} /api/files/${f.id}`).join("; "),
        ];
      }),
    ];
    if (section === "assets")
      rows.push(
        [],
        [
          "Fixed asset",
          "FY start",
          "Currency",
          "Cost minor",
          "Opening minor",
          "Depreciation minor",
          "Disposal minor",
          "Closing minor",
        ],
        ...summary.schedules.map((r) => [
          r.title,
          data.q.fiscalYear,
          r.currency,
          r.costMinor,
          r.openingMinor,
          r.depreciationMinor,
          r.disposalMinor,
          r.closingMinor,
        ]),
      );
    if (section === "funds")
      rows.push(
        [],
        [
          "Fund",
          "Currency",
          "Budget minor",
          "Committed minor",
          "Remaining minor",
          "Warnings",
        ],
        ...summary.funds.map((f) => [
          f.title,
          f.currency,
          f.budgetMinor,
          f.committedMinor,
          f.remainingMinor,
          f.issues.join("; "),
        ]),
        [],
        ["Fund ID", "Category ID", "Kind", "Currency", "Actual minor"],
        ...summary.utilisation.map((r) => [
          r.fundId,
          r.categoryId,
          r.kind,
          r.currency,
          r._sum.amountMinor,
        ]),
      );
    rows.push(
      [],
      ["Record ID", "Action", "Actor ID", "When", "Reference", "Notes"],
      ...data.rows.flatMap((r) =>
        r.events.map((e) => [
          r.id,
          e.action,
          e.actorId,
          e.createdAt,
          e.reference,
          e.notes,
        ]),
      ),
    );
    await recordAuditEvent({
      workspaceId: actor.workspace.id,
      actorId: actor.user.id,
      action: "moneycontrols.exported",
      targetType: "money_control",
      metadata: { section, count: data.rows.length },
    });
    return new Response(csv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="space-works-${section}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof FinanceError) return new Response(null, { status: 404 });
    throw e;
  }
}
