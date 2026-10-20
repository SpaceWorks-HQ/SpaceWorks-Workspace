import { formatDay } from "@/lib/finance/dates";
import Link from "next/link";
import { Card, Chip, EmptyState, PageHeader } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { FinanceAttachments } from "@/components/finance/FinanceAttachments";
import { RecurringForm } from "./Forms";
import { costKinds, frequencies } from "@/lib/finance/recurring/rules";
import { label } from "@/lib/finance/tools-rules";
import { formatMoney } from "@/lib/format/money";
import { minorToDecimalString } from "@/lib/finance/money";
import type {
  ScheduleView,
  RecurringQuery,
  UpcomingView,
} from "@/lib/finance/recurring/queries";
import type { FormField } from "@/components/finance/ToolForm";
export const pretty = (v: Date | string | null | undefined) =>
  v ? formatDay(typeof v === "string" ? new Date(v) : v) : "—";
export const date = (v: Date | null | undefined) =>
  v?.toISOString().slice(0, 10) ?? "";
export const hidden = (name: string, value: string): FormField => ({
  name,
  label: name,
  type: "hidden",
  value,
});
export const select = (
  name: string,
  label: string,
  options: { id: string; name: string }[],
  value = "",
  required = false,
): FormField => ({ name, label, type: "select", options, value, required });
export const text = (
  name: string,
  label: string,
  value = "",
  type: FormField["type"] = "text",
  required = false,
): FormField => ({ name, label, value, type, required });
const opts = (values: readonly string[]) =>
  values.map((id) => ({ id, name: label(id) }));
export function CostNav({
  slug,
  finance = true,
  payroll = false,
}: {
  slug: string;
  finance?: boolean;
  payroll?: boolean;
}) {
  const items = [
    ...(finance
      ? [
          { path: "recurring", label: "Recurring costs" },
          { path: "dues", label: "Upcoming dues" },
        ]
      : []),
    { path: "advances", label: "Staff advances" },
    ...(payroll ? [{ path: "payroll/dues", label: "Payroll dues" }] : []),
  ];
  return (
    <nav aria-label="Recurring finance tools" className="flex flex-wrap gap-3">
      {items.map((item) => (
        <Link
          key={item.path}
          className={buttonClasses({ variant: "quiet" })}
          href={`/w/${slug}/finance/${item.path}`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
export function Filters({
  view,
  query,
  dues = false,
}: {
  view: Pick<ScheduleView, "pickers">;
  query: RecurringQuery;
  dues?: boolean;
}) {
  return (
    <form className="grid min-w-0 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Field label="Search">
        <Input name="q" defaultValue={query.q} maxLength={120} />
      </Field>
      <Field label="Type">
        <Dropdown name="kind" defaultValue={query.kind ?? ""}>
          <option value="">All types</option>
          {[
            ...costKinds,
            ...(dues
              ? ["BILL", "PF", "ESI", "PT", "SALARY_TDS", "ADVANCE_RECOVERY"]
              : []),
          ].map((k) => (
            <option key={k} value={k}>
              {label(k)}
            </option>
          ))}
        </Dropdown>
      </Field>
      <Field label="Fund">
        <Dropdown name="fund" defaultValue={query.fund ?? ""}>
          <option value="">All funds</option>
          {view.pickers.funds.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Dropdown>
      </Field>
      <Field label="Cost centre">
        <Dropdown name="centre" defaultValue={query.centre ?? ""}>
          <option value="">All cost centres</option>
          {view.pickers.centres.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </Dropdown>
      </Field>
      {dues ? (
        <Field label="Window">
          <Dropdown name="days" defaultValue={query.days ?? "30"}>
            {[30, 60, 90].map((n) => (
              <option key={n} value={n}>
                Next {n} days
              </option>
            ))}
          </Dropdown>
        </Field>
      ) : (
        <Field label="Status">
          <Dropdown name="status" defaultValue={query.status ?? ""}>
            <option value="">All statuses</option>
            {["ACTIVE", "PAUSED", "ENDED"].map((n) => (
              <option key={n} value={n}>
                {label(n)}
              </option>
            ))}
          </Dropdown>
        </Field>
      )}
      <button className={buttonClasses({ variant: "secondary" })}>
        Apply filters
      </button>
      {dues ? (
        <>
          <Field label="Payment status">
            <Dropdown name="status" defaultValue={query.status ?? ""}>
              <option value="">Outstanding</option>
              <option value="paid">Paid</option>
            </Dropdown>
          </Field>
          <Field label="Currency">
            <Input
              name="currency"
              maxLength={3}
              defaultValue={query.currency}
              placeholder="All currencies"
            />
          </Field>
        </>
      ) : null}
    </form>
  );
}
export function PageLinks({
  base,
  query,
  page,
  total,
}: {
  base: string;
  query: RecurringQuery;
  page: number;
  total: number;
}) {
  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p>
        {total} records · Page {page}
      </p>
      {page > 1 ? (
        <Link
          className={buttonClasses({ variant: "quiet" })}
          href={`${base}?${new URLSearchParams({ ...query, page: String(page - 1) })}`}
        >
          Previous
        </Link>
      ) : null}
      {page * 40 < total ? (
        <Link
          className={buttonClasses({ variant: "quiet" })}
          href={`${base}?${new URLSearchParams({ ...query, page: String(page + 1) })}`}
        >
          Next
        </Link>
      ) : null}
    </nav>
  );
}
export function ScheduleScreen({
  slug,
  view,
  query,
}: {
  slug: string;
  view: ScheduleView;
  query: RecurringQuery;
}) {
  const s = view.selected,
    base = `/w/${slug}/finance`,
    currency = s?.currency ?? view.defaultCurrency;
  const amount = (v: number | undefined) =>
    minorToDecimalString(v ?? 0, currency);
  const fields: FormField[] = [
    hidden("requestKey", s?.requestKey ?? crypto.randomUUID()),
    hidden("id", s?.id ?? ""),
    text("title", "Cost name", s?.title ?? "", "text", true),
    select("kind", "Type", opts(costKinds), s?.kind ?? "RENT", true),
    text("payee", "Payee / lender", s?.payee ?? "", "text", true),
    text(
      "amountMinor",
      "Base amount before GST / withholding",
      amount(s?.amountMinor),
      "money",
      true,
    ),
    text("currency", "Currency", currency, "text", true),
    {
      name: "estimated",
      label: "Estimate — enter the actual amount each time",
      type: "checkbox",
      value: s?.estimated ?? false,
    },
    select(
      "frequency",
      "Frequency",
      opts(frequencies),
      s?.frequency ?? "MONTHLY",
      true,
    ),
    text(
      "dueDay",
      "Due day (1–31; clamps to month end)",
      String(s?.dueDay ?? 1),
      "text",
      true,
    ),
    text(
      "startsOn",
      "First period starts",
      date(s?.startsOn) || view.today,
      "date",
      true,
    ),
    text("endsOn", "End date", date(s?.endsOn), "date"),
    text(
      "leadDays",
      "Create bills this many days before due (0–90)",
      String(s?.leadDays ?? 14),
    ),
    text(
      "reminderDays",
      "Reminder lead days (0–90)",
      String(s?.reminderDays ?? 7),
    ),
    select(
      "status",
      "Status",
      opts(["ACTIVE", "PAUSED", "ENDED"]),
      s?.status ?? "ACTIVE",
      true,
    ),
    select("ownerId", "Owner", view.pickers.members, s?.ownerId ?? ""),
  ];
  const advanced: FormField[] = [
    select(
      "categoryId",
      "Expense category",
      view.pickers.categories.filter((c) => c.kind === "EXPENSE"),
      s?.categoryId ?? "",
    ),
    select(
      "accountId",
      "Payment account",
      view.pickers.accounts,
      s?.accountId ?? "",
    ),
    select("fundId", "Default fund", view.pickers.funds, s?.fundId ?? ""),
    select(
      "costCentreId",
      "Default cost centre",
      view.pickers.centres,
      s?.costCentreId ?? "",
    ),
    select("contactId", "CRM contact", view.contacts, s?.contactId ?? ""),
    select(
      "organisationId",
      "CRM organisation",
      view.organisations,
      s?.organisationId ?? "",
    ),
    text(
      "gstPercent",
      "GST % (review applicability)",
      String(s?.gstPercent ?? 0),
    ),
    text("tdsSection", "TDS section / withholding code", s?.tdsSection ?? ""),
    text(
      "tdsPercent",
      "TDS % (review applicability)",
      String(s?.tdsPercent ?? 0),
    ),
    select("leaseId", "Facility lease", view.leases, s?.leaseId ?? ""),
    select(
      "subscriptionId",
      "Subscription",
      view.subscriptions,
      s?.subscriptionId ?? "",
    ),
    select(
      "insuranceId",
      "Insurance register entry",
      view.insurance,
      s?.insuranceId ?? "",
    ),
    select(
      "depositId",
      "Security deposit in Money controls",
      view.deposits,
      s?.depositId ?? "",
    ),
    text("renewalOn", "Rent renewal date", date(s?.renewalOn), "date"),
    text(
      "escalationPercent",
      "Rent escalation % to agree at renewal",
      String(s?.escalationPercent ?? 0),
    ),
    text(
      "renewalReminderDays",
      "Remind before renewal (days)",
      String(s?.renewalReminderDays ?? 30),
    ),
    text(
      "principalMinor",
      "Loan principal (EMI only)",
      amount(s?.principalMinor),
      "money",
    ),
    text(
      "annualRatePercent",
      "Annual loan interest % (reference only)",
      String(s?.annualRatePercent ?? 0),
    ),
    text("tenure", "Number of EMIs", String(s?.tenure ?? 0)),
    text("notes", "Notes", s?.notes ?? "", "textarea"),
  ];
  return (
    <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title="Recurring costs"
        description="Rent, utilities and other regular dues. Each payment goes through Finance bills."
      />
      <CostNav slug={slug} payroll={view.payrollView} />
      <Filters view={view} query={query} />
      <a
        className="min-h-11 py-3 text-primary underline"
        href={`${base}/recurring/export?${new URLSearchParams({ ...query, kind: query.kind ?? "", export: "schedules" })}`}
      >
        Export schedules CSV
      </a>
      <Card>
        <h2 className="mb-3 text-xl font-semibold">Fixed monthly cash burn</h2>
        <p className="mb-4 text-sm text-ink-secondary">
          Active fixed schedules in these filters, including entered GST and
          withholding. Estimates are excluded. Each currency stays separate.
        </p>
        <ul className="divide-y divide-line">
          {view.burn.map((b, i) => (
            <li className="flex flex-wrap justify-between gap-3 py-3" key={i}>
              <span>
                {view.pickers.funds.find((f) => f.id === b.fundId)?.name ??
                  "No fund"}{" "}
                ·{" "}
                {view.pickers.centres.find((c) => c.id === b.costCentreId)
                  ?.name ?? "No cost centre"}
              </span>
              <strong>{formatMoney(b.amountMinor, b.currency)}</strong>
            </li>
          ))}
        </ul>
      </Card>
      {view.schedules.length ? (
        <ul className="space-y-3">
          {view.schedules.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Link
                    className="min-h-11 break-words py-2 text-lg font-semibold text-primary underline"
                    href={`${base}/recurring?edit=${r.id}`}
                  >
                    {r.title}
                  </Link>
                  <Chip>{label(r.status)}</Chip>
                </div>
                <p>
                  {r.payee} · {label(r.kind)} ·{" "}
                  {formatMoney(r.amountMinor, r.currency)}{" "}
                  {label(r.frequency).toLowerCase()}
                  {r.estimated ? " (estimate)" : ""}
                </p>
                <p className="mt-2 text-sm text-ink-secondary">
                  Monthly base equivalent{" "}
                  {formatMoney(r.monthlyMinor, r.currency)} · Next due{" "}
                  {pretty(r.nextDueOn)} · {r.overdue} overdue
                </p>
                {r.kind === "EMI" ? (
                  <p className="mt-2 text-sm">
                    Outstanding principal{" "}
                    {formatMoney(r.outstandingPrincipalMinor, r.currency)} ·{" "}
                    {r.tenure} instalments · {r.annualRatePercent}% entered rate
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          patch="idle"
          title="No recurring costs yet."
          action={
            <Link
              className={buttonClasses({ variant: "primary" })}
              href="#schedule-form"
            >
              Add a schedule
            </Link>
          }
        />
      )}
      <PageLinks
        base={`${base}/recurring`}
        query={query}
        page={view.page}
        total={view.total}
      />
      <Card id="schedule-form">
        <h2 className="mb-4 text-xl font-semibold">
          {s ? "Edit schedule" : "Add a schedule"}
        </h2>
        <p className="mb-4 text-sm text-ink-secondary">
          Changes apply to future bills. Existing dues keep their amounts. Tax
          rates and deadlines are manually reviewed facts.
        </p>
        <RecurringForm
          key={s?.id ?? "new"}
          slug={slug}
          operation="schedule"
          fields={fields}
          advanced={advanced}
          button="Save schedule"
        />
        {s ? (
          <div className="mt-5">
            <FinanceAttachments
              key={s.id}
              slug={slug}
              type="RECURRING"
              recordId={s.id}
              initial={view.files[s.id] ?? []}
            />
          </div>
        ) : null}
      </Card>
      <Card>
        <h2 className="mb-4 text-xl font-semibold">
          Create from an existing record
        </h2>
        <div className="grid gap-5 sm:grid-cols-3">
          {(
            [
              ["LEASE", view.leases, "Lease"],
              ["INSURANCE", view.insurance, "Insurance"],
              ["SUBSCRIPTION", view.subscriptions, "Subscription"],
            ] as const
          ).map(([source, choices, name]) => (
            <RecurringForm
              key={source}
              slug={slug}
              operation="source"
              fields={[
                hidden("source", source),
                select("sourceId", name, choices, "", true),
              ]}
              button={`Use ${name.toLowerCase()}`}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}
export function DuesScreen({
  slug,
  view,
  query,
}: {
  slug: string;
  view: UpcomingView;
  query: RecurringQuery;
}) {
  const base = `/w/${slug}/finance`,
    pageBase = `${base}/${view.payrollOnly ? "payroll/dues" : "dues"}`;
  return (
    <div className="mx-auto flex max-w-6xl min-w-0 flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title={
          view.payrollOnly
            ? "Payroll remittances and recoveries"
            : "Upcoming dues"
        }
        description="Overdue first, then the next 30, 60 or 90 days. Future schedules appear as projections until their bill is created."
      />
      <CostNav
        slug={slug}
        finance={view.financeManage}
        payroll={view.payrollOnly || view.payrollManage}
      />
      <Filters view={view} query={query} dues />
      <a
        className="min-h-11 py-3 text-primary underline"
        href={`${base}/recurring/export?${new URLSearchParams({ ...query, export: view.payrollOnly ? "payroll" : "dues" })}`}
      >
        Export dues CSV
      </a>
      {view.payrollOnly ? (
        <p className="text-sm text-ink-secondary">
          PF / ESI default to the 15th, salary withholding to the 7th of the
          next month. PT defaults to the 15th. Review local applicability and
          change each unpaid due date as needed.
        </p>
      ) : null}
      {view.rows.length ? (
        <ul className="space-y-4">
          {view.rows.map((r) => {
            const editable = !r.privatePayroll || view.payrollManage,
              unpaid = r.amountMinor - r.paidMinor;
            return (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 className="max-w-full break-words text-lg font-semibold">
                      {r.title}
                    </h2>
                    <Chip
                      tone={
                        r.dueOn < view.today && unpaid ? "danger" : "neutral"
                      }
                    >
                      {r.projected
                        ? "Projected"
                        : r.needsActual
                          ? "Needs actual amount"
                          : unpaid
                            ? r.dueOn < view.today
                              ? "Overdue"
                              : "Due"
                            : "Paid"}
                    </Chip>
                  </div>
                  <p className="mt-2">
                    {label(r.kind)} · Due {pretty(r.dueOn)} ·{" "}
                    {formatMoney(unpaid, r.currency)} outstanding
                  </p>
                  <p className="mt-2 text-sm text-ink-secondary">
                    {view.pickers.funds.find((f) => f.id === r.fundId)?.name ??
                      "No fund"}{" "}
                    ·{" "}
                    {view.pickers.centres.find((f) => f.id === r.costCentreId)
                      ?.name ?? "No cost centre"}
                    {r.paidOn
                      ? ` · Last paid ${pretty(r.paidOn)} · ${r.reference}`
                      : ""}
                  </p>
                  {r.projected ? (
                    <Link
                      href={`${base}/recurring?edit=${r.scheduleId}`}
                      className="inline-flex min-h-11 items-center text-primary underline"
                    >
                      Review schedule
                    </Link>
                  ) : r.kind === "ADVANCE_RECOVERY" ? (
                    <Link
                      href={`${base}/advances`}
                      className="inline-flex min-h-11 items-center text-primary underline"
                    >
                      Record recovery
                    </Link>
                  ) : (
                    <>
                      {r.billId && editable && unpaid > 0 ? (
                        <>
                          {r.scheduleId && r.paidMinor === 0 ? (
                            <details className="mt-3">
                              <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                                {r.kind === "EMI"
                                  ? "Confirm principal and interest"
                                  : r.needsActual
                                    ? "Enter actual amount"
                                    : "Review this bill’s amount"}
                              </summary>
                              <RecurringForm
                                slug={slug}
                                operation="actual"
                                fields={[
                                  hidden("billId", r.billId),
                                  hidden("currency", r.currency),
                                  text(
                                    "amountMinor",
                                    "Cash payable after withholding",
                                    minorToDecimalString(
                                      r.amountMinor,
                                      r.currency,
                                    ),
                                    "money",
                                    true,
                                  ),
                                  ...(r.kind === "EMI"
                                    ? [
                                        text(
                                          "principalMinor",
                                          "Principal",
                                          minorToDecimalString(
                                            r.principalMinor,
                                            r.currency,
                                          ),
                                          "money",
                                          true,
                                        ),
                                        text(
                                          "interestMinor",
                                          "Interest",
                                          minorToDecimalString(
                                            r.interestMinor,
                                            r.currency,
                                          ),
                                          "money",
                                          true,
                                        ),
                                      ]
                                    : [
                                        text(
                                          "cgstMinor",
                                          "CGST included",
                                          minorToDecimalString(
                                            r.cgstMinor ?? 0,
                                            r.currency,
                                          ),
                                          "money",
                                        ),
                                        text(
                                          "sgstMinor",
                                          "SGST / UTGST included",
                                          minorToDecimalString(
                                            r.sgstMinor ?? 0,
                                            r.currency,
                                          ),
                                          "money",
                                        ),
                                        text(
                                          "igstMinor",
                                          "IGST included",
                                          minorToDecimalString(
                                            r.igstMinor ?? 0,
                                            r.currency,
                                          ),
                                          "money",
                                        ),
                                        text(
                                          "tdsMinor",
                                          "TDS withheld",
                                          minorToDecimalString(
                                            r.tdsMinor,
                                            r.currency,
                                          ),
                                          "money",
                                        ),
                                      ]),
                                ]}
                                button="Confirm actual amount"
                              />
                            </details>
                          ) : null}
                          {!r.needsActual &&
                          (r.kind !== "EMI" || r.splitConfirmed) ? (
                            <details className="mt-3">
                              <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                                Record payment
                              </summary>
                              <RecurringForm
                                slug={slug}
                                operation="pay"
                                fields={[
                                  hidden("billId", r.billId),
                                  hidden("currency", r.currency),
                                  hidden("paymentKey", crypto.randomUUID()),
                                  text(
                                    "amountMinor",
                                    "Cash paid",
                                    minorToDecimalString(unpaid, r.currency),
                                    "money",
                                    true,
                                  ),
                                  text(
                                    "paidOn",
                                    "Paid on",
                                    view.today,
                                    "date",
                                    true,
                                  ),
                                  text(
                                    "reference",
                                    r.privatePayroll
                                      ? "Challan / payment reference"
                                      : "Payment reference",
                                    "",
                                    "text",
                                    true,
                                  ),
                                ]}
                                button="Record payment and post"
                              />
                            </details>
                          ) : null}
                          {r.privatePayroll ? (
                            <details className="mt-3">
                              <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                                Change remittance due date
                              </summary>
                              <RecurringForm
                                slug={slug}
                                operation="remittanceDue"
                                fields={[
                                  hidden("billId", r.billId),
                                  text(
                                    "dueOn",
                                    "Reviewed due date",
                                    r.dueOn,
                                    "date",
                                    true,
                                  ),
                                ]}
                                button="Save due date"
                              />
                            </details>
                          ) : null}
                        </>
                      ) : null}
                      {r.billId ? (
                        <div className="mt-4">
                          <FinanceAttachments
                            slug={slug}
                            type="BILL"
                            recordId={r.billId}
                            initial={view.files[r.billId] ?? []}
                            editable={editable}
                          />
                        </div>
                      ) : null}
                    </>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          patch="idle"
          title="No dues in this window."
          action={
            <Link
              className={buttonClasses({ variant: "primary" })}
              href={`${base}/recurring`}
            >
              Review schedules
            </Link>
          }
        />
      )}
      <PageLinks
        base={pageBase}
        query={query}
        page={view.page}
        total={view.total}
      />
    </div>
  );
}
