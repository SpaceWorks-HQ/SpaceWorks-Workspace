import Link from "next/link";
import { Card, CardHeader, EmptyState } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import type { FinanceActor } from "@/lib/finance/tools/access";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
import type { PayrollView } from "@/lib/finance/tools/views";
import { ToolForm } from "./ToolForm";
import { formatMoney } from "@/lib/format/money";
import { localDate } from "@/lib/finance/dates";
import { FinanceFilters } from "./FinanceFilters";
import { PayrollProfiles } from "./PayrollProfiles";
import { PayrollRuns } from "./PayrollRuns";
import { GroupTable } from "./FinanceReports";

export function PayrollScreen({
  actor,
  query,
  view,
}: {
  actor: FinanceActor;
  query: FinanceQuery;
  view: PayrollView;
}) {
  const { grants, members, payroll } = view;
  const isOwner = actor.membership.role === "OWNER";
  const slug = actor.workspace.slug,
    base = `/w/${slug}/finance`,
    today = localDate(new Date(), actor.workspace.timezone);
  const accessPanel = isOwner ? (
    <Card>
      <div className="mb-4 flex flex-wrap gap-4"><Link className="min-h-11 py-3 text-accent-text underline" href={`${base}/payroll/dues`}>Payroll remittances</Link><Link className="min-h-11 py-3 text-accent-text underline" href={`${base}/advances`}>Staff advances and loans</Link></div>
      <CardHeader
        title="Payroll access"
        description="Admin status does not grant payroll access. Choose who may view and who may manage pay records."
      />
      <ul className="mb-4 divide-y divide-line">
        {grants.map((g) => (
          <li className="py-2" key={g.userId}>
            {members.find((m) => m.userId === g.userId)?.user.name ??
              "Former member"}{" "}
            · {g.manage ? "Manage payroll" : "View payroll"}
          </li>
        ))}
      </ul>
      <ToolForm
        slug={slug}
        operation="grant"
        fields={[
          {
            name: "userId",
            label: "Member",
            type: "select",
            required: true,
            options: members.map((m) => ({
              id: m.userId,
              name: m.user.name ?? "Former member",
            })),
          },
          {
            name: "access",
            label: "Payroll permission",
            type: "select",
            required: true,
            options: [
              { id: "VIEW", name: "View" },
              { id: "MANAGE", name: "View and manage" },
              { id: "NONE", name: "Remove payroll access" },
            ],
          },
        ]}
        button="Save payroll access"
      />
    </Card>
  ) : null;
  if (!payroll)
    return (
      <div className="flex flex-col gap-5">
        <h2 className="text-h2">Payroll</h2>
        {accessPanel}
        <EmptyState
          patch
          title="Grant payroll access to start the pay register."
        />
      </div>
    );
  const { data, pickers: p } = payroll;
  const runs = data.runs.filter((r) => r.currency === data.period.currency);
  const byCentre = new Map<
    string,
    {
      name: string;
      incomeMinor: number;
      expenseMinor: number;
      netMinor: number;
      count: number;
    }
  >();
  for (const r of runs) {
    const name =
        p.centres.find((c) => c.id === r.costCentreId)?.name ??
        "No cost centre",
      prior = byCentre.get(name) ?? {
        name,
        incomeMinor: 0,
        expenseMinor: 0,
        netMinor: 0,
        count: 0,
      };
    prior.expenseMinor += r.grossMinor + r.allowancesMinor;
    prior.netMinor = -prior.expenseMinor;
    prior.count++;
    byCentre.set(name, prior);
  }
  const statutory = [
    ["PF", runs.reduce((n, r) => n + r.pfMinor, 0)],
    ["ESI", runs.reduce((n, r) => n + r.esiMinor, 0)],
    ["Professional tax", runs.reduce((n, r) => n + r.ptMinor, 0)],
    ["TDS", runs.reduce((n, r) => n + r.tdsMinor, 0)],
  ] as const;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-h2">Pay register</h2>
        <p className="text-ink-muted">
          Manual pay records. Every view is audited. Another payroll manager
          approves each run.
        </p>
      </div>
      <FinanceFilters
        query={{ ...query, month: data.period.month }}
        month
        currency={data.period.currency}
      />
      <div className="flex flex-wrap gap-4"><Link className="min-h-11 py-3 text-accent-text underline" href={`${base}/payroll/dues`}>Payroll remittances</Link><Link className="min-h-11 py-3 text-accent-text underline" href={`${base}/advances`}>Staff advances and loans</Link></div>
      {accessPanel}
      <Card>
        <CardHeader
          title={`Payroll cost for ${data.period.month}`}
          description="Gross pay and allowances, before deductions. No statutory rates are calculated."
        />
        <p className="text-h2">
          {formatMoney(
            runs.reduce((n, r) => n + r.grossMinor + r.allowancesMinor, 0),
            data.period.currency,
          )}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a
            href={`${base}/export/payroll?month=${data.period.month}&currency=${data.period.currency}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Payroll CSV
          </a>
          <a
            href={`${base}/export/statutory?month=${data.period.month}&currency=${data.period.currency}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Statutory summary CSV
          </a>
        </div>
      </Card>
      <GroupTable
        title="Payroll cost by cost centre"
        rows={[...byCentre.values()]}
        currency={data.period.currency}
      />
      <Card>
        <CardHeader
          title="Statutory amounts to deposit"
          description="Totals of manually entered deductions for this pay month. Add employer contributions and payment deadlines in the checklist as needed."
        />
        <dl className="grid gap-3 sm:grid-cols-2">
          {statutory.map(([name, n]) => (
            <div key={name}>
              <dt className="text-ink-muted">{name}</dt>
              <dd className="text-title">
                {formatMoney(n, data.period.currency)}
              </dd>
            </div>
          ))}
        </dl>
        <Link
          href={`${base}/close?month=${data.period.month}`}
          className={buttonClasses({ variant: "quiet" })}
        >
          Open month-end compliance steps
        </Link>
      </Card>
      <PayrollProfiles
        slug={slug}
        payroll={payroll}
        currency={actor.workspace.currency}
      />
      <PayrollRuns
        slug={slug}
        payroll={payroll}
        today={today}
        currency={actor.workspace.currency}
      />
    </div>
  );
}
