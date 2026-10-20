import Link from "next/link";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import type { FinanceActor } from "@/lib/finance/tools/access";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
import type { PayrollView } from "@/lib/finance/tools/views";
import { ToolForm, type FormField } from "./ToolForm";
import { currencyField, hidden, money, options, tagFields } from "./ToolFields";
import { EditPanel, AttachedFiles } from "./FinanceToolScreen";
import { formatMoney } from "@/lib/format/money";
import { minorToDecimalString } from "@/lib/finance/money";
import { formatDay, localDate } from "@/lib/finance/dates";
import { label, payTotals } from "@/lib/finance/tools-rules";
import { FinanceFilters } from "./FinanceFilters";
import { PayDetails, PayslipButton } from "./PayrollActions";
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
  const { data, pickers: p, files } = payroll;
  const runs = data.runs.filter((r) => r.currency === data.period.currency);
  const profileFields = (v?: (typeof data.profiles)[number]): FormField[] => [
    ...(v ? [hidden("id", v.id)] : []),
    { name: "name", label: "Person's name", required: true, value: v?.name },
    {
      name: "userId",
      label: "Workspace member",
      type: "select",
      options: p.members,
      value: v?.userId ?? "",
    },
    {
      name: "kind",
      label: "Engagement",
      type: "select",
      options: options(["STAFF", "CONSULTANT", "VOLUNTEER", "INTERN"]),
      value: v?.kind ?? "STAFF",
      required: true,
    },
    currencyField(v?.currency ?? actor.workspace.currency),
    money(
      "rateMinor",
      "Monthly amount or rate",
      v ? minorToDecimalString(v.rateMinor, v.currency) : "",
      true,
    ),
    {
      name: "rateBasis",
      label: "Rate basis",
      type: "select",
      options: options(["MONTH", "DAY", "HOUR", "ASSIGNMENT"]),
      value: v?.rateBasis ?? "MONTH",
      required: true,
    },
    {
      name: "pan",
      label: "PAN",
      helper: v
        ? "Leave blank to keep the existing PAN."
        : "Optional. Stored privately.",
    },
    {
      name: "bankLast4",
      label: "Bank account last four digits",
      maxLength: 4,
      helper: "Only four digits are accepted.",
    },
    { name: "ifsc", label: "IFSC", maxLength: 11 },
    {
      name: "tdsSection",
      label: "TDS section",
      value: v?.tdsSection ?? "",
      helper:
        "For example 192, 194J or 194C; use a local tax reference outside India.",
    },
    {
      name: "costCentreId",
      label: "Default cost centre",
      type: "select",
      options: p.centres,
      value: v?.costCentreId ?? "",
    },
    ...[
      ["pfApplicable", "Provident fund applies"],
      ["esiApplicable", "ESI applies"],
      ["ptApplicable", "Professional tax applies"],
    ].map(([name, text]) => ({
      name: name!,
      label: text!,
      type: "checkbox" as const,
      value: !!v?.[name as "pfApplicable" | "esiApplicable" | "ptApplicable"],
    })),
    ...(v
      ? [
          {
            name: "clearPan",
            label: "Clear the stored PAN",
            type: "checkbox" as const,
          },
          {
            name: "clearBank",
            label: "Clear the stored bank reference",
            type: "checkbox" as const,
          },
          {
            name: "archived",
            label: "Archive this pay profile",
            type: "checkbox" as const,
            value: !!v.archivedAt,
          },
        ]
      : []),
  ];
  const payFields = (
    profile: (typeof data.profiles)[number],
    r?: (typeof data.runs)[number],
  ): FormField[] => [
    ...(r ? [hidden("id", r.id)] : []),
    hidden("profileId", profile.id),
    {
      name: "month",
      label: "Pay month",
      type: "month",
      value: r?.month ?? data.period.month,
      required: true,
      min: "2000-01",
      max: "2099-12",
    },
    ...[
      ["grossMinor", "Gross pay"],
      ["allowancesMinor", "Allowances"],
      ["pfMinor", "PF deduction"],
      ["esiMinor", "ESI deduction"],
      ["ptMinor", "Professional tax deduction"],
      ["tdsMinor", "TDS deduction"],
      ["advancesMinor", "Advances recovered"],
      ["otherMinor", "Other deductions"],
    ].map(([name, text]) =>
      money(
        name!,
        text!,
        r
          ? minorToDecimalString(
              r[name as "grossMinor" | "allowancesMinor"],
              r.currency,
            )
          : name === "grossMinor" && profile.rateBasis === "MONTH"
            ? minorToDecimalString(profile.rateMinor, profile.currency)
            : "0",
        true,
      ),
    ),
    ...tagFields(p, r ?? { costCentreId: profile.costCentreId }).filter(
      (f) => f.name !== "purpose",
    ),
    { name: "notes", label: "Notes", type: "textarea", value: r?.notes ?? "" },
  ];
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
      {!data.profiles.length ? (
        <EmptyState
          patch
          title="No pay profiles yet. Add the first person."
          action={
            data.manage ? (
              <a
                href="#add-profile"
                className={buttonClasses({ variant: "secondary" })}
              >
                Add a pay profile
              </a>
            ) : undefined
          }
        />
      ) : null}
      {data.profiles.map((profile) => (
        <Card key={profile.id}>
          <CardHeader
            title={profile.name}
            description={`${label(profile.kind)} · ${formatMoney(profile.rateMinor, profile.currency)} per ${label(profile.rateBasis)}`}
            action={profile.archivedAt ? <Chip>Archived</Chip> : undefined}
          />
          <PayDetails slug={slug} profileId={profile.id} />
          <AttachedFiles
            slug={slug}
            files={files}
            type="PAY_PROFILE"
            id={profile.id}
            editable={data.manage}
          />
          {data.manage ? (
            <div className="mt-4 flex flex-col gap-3">
              <EditPanel title="Edit private pay profile">
                <ToolForm
                  slug={slug}
                  operation="payProfile"
                  fields={profileFields(profile)}
                  button="Save pay profile"
                />
              </EditPanel>
              {!profile.archivedAt ? (
                <EditPanel title={`Prepare ${data.period.month} pay run`}>
                  <ToolForm
                    slug={slug}
                    operation="payRun"
                    fields={payFields(profile)}
                    button="Save draft pay run"
                  />
                </EditPanel>
              ) : null}
            </div>
          ) : null}
        </Card>
      ))}
      {data.manage ? (
        <div id="add-profile">
          <EditPanel title="Add a pay profile">
            <ToolForm
              slug={slug}
              operation="payProfile"
              fields={profileFields()}
              button="Add pay profile"
              reset
            />
          </EditPanel>
        </div>
      ) : null}
      <h3 className="text-h3">{data.period.month} pay runs</h3>
      {!runs.length ? (
        <p className="text-ink-muted">
          No pay runs in this month and currency.
        </p>
      ) : null}
      {runs.map((r) => (
        <Card key={r.id}>
          <CardHeader
            title={r.profile.name}
            description={r.month}
            action={
              <Chip
                tone={
                  r.status === "PAID"
                    ? "success"
                    : r.status === "APPROVED"
                      ? "info"
                      : "neutral"
                }
              >
                {label(r.status)}
              </Chip>
            }
          />
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              ["Earnings", payTotals(r).earningsMinor],
              ["Deductions", payTotals(r).deductionsMinor],
              ["Net pay", r.netMinor],
            ].map(([name, n]) => (
              <div key={name}>
                <dt className="text-ink-muted">{name}</dt>
                <dd className="text-title">
                  {formatMoney(Number(n), r.currency)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-body-ui text-ink-muted">
            {r.paidOn
              ? `Paid ${formatDay(r.paidOn)} · ${r.reference}`
              : "Not paid"}{" "}
            · {r.ledgerEntryId ? "Posted to ledger" : "Not posted to ledger"}
          </p>
          <div className="mt-4">
            <AttachedFiles
              slug={slug}
              files={files}
              type="PAY_RUN"
              id={r.id}
              editable={data.manage}
            />
          </div>
          {data.manage ? (
            <div className="mt-4 flex flex-col gap-3">
              {r.status === "DRAFT" ? (
                <>
                  <EditPanel title="Edit draft amounts">
                    <ToolForm
                      slug={slug}
                      operation="payRun"
                      fields={payFields(
                        data.profiles.find((p) => p.id === r.profileId)!,
                        r,
                      )}
                      button="Save draft amounts"
                    />
                  </EditPanel>
                  <ToolForm
                    slug={slug}
                    operation="payTransition"
                    fields={[
                      hidden("runId", r.id),
                      hidden("transition", "APPROVE"),
                    ]}
                    button="Approve pay run"
                  />
                </>
              ) : r.status === "APPROVED" ? (
                <>
                  <ToolForm
                    slug={slug}
                    operation="payTransition"
                    fields={[
                      hidden("runId", r.id),
                      hidden("transition", "PAY"),
                      {
                        name: "paidOn",
                        label: "Paid date",
                        type: "date",
                        value: today,
                        required: true,
                      },
                      {
                        name: "reference",
                        label: "Payment reference or UTR",
                        required: true,
                      },
                    ]}
                    button="Mark paid"
                  />
                  <ToolForm
                    slug={slug}
                    operation="payTransition"
                    fields={[
                      hidden("runId", r.id),
                      hidden("transition", "REOPEN"),
                    ]}
                    button="Return to draft"
                  />
                </>
              ) : !r.ledgerEntryId ? (
                <ToolForm
                  slug={slug}
                  operation="payTransition"
                  fields={[hidden("runId", r.id), hidden("transition", "POST")]}
                  button="Post net payment to ledger"
                />
              ) : null}
            </div>
          ) : null}
          {data.manage && r.status === "PAID" ? (
            <div className="mt-4">
              <EditPanel title="Correct payroll bookkeeping">
                <ToolForm
                  slug={slug}
                  operation="payBookkeeping"
                  fields={[hidden("runId", r.id), ...tagFields(p, r)]}
                  button="Save payroll bookkeeping"
                />
              </EditPanel>
            </div>
          ) : null}
          {r.status === "PAID" ? (
            <div className="mt-4">
              <PayslipButton slug={slug} runId={r.id} />
              <Link
                href={`${base}/payroll/${r.id}/print`}
                className={buttonClasses({ variant: "quiet" })}
              >
                Printable payslip
              </Link>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
