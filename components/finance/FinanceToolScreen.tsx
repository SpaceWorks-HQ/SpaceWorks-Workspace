import { randomUUID } from "node:crypto";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { ToolForm, type FormField } from "./ToolForm";
import { FinanceAttachments } from "./FinanceAttachments";
import { MoneyRecordForm } from "./MoneyRecordForm";
import { FinanceFilters } from "./FinanceFilters";
import {
  currencyField,
  hidden,
  money,
  options,
  tagFields,
  taxFields,
} from "./ToolFields";
import {
  billStatus,
  centreKinds,
  disbursementKinds,
  label,
} from "@/lib/finance/tools-rules";
import { formatDay, isoDay, localDate } from "@/lib/finance/dates";
import { minorToDecimalString } from "@/lib/finance/money";
import { formatMoney } from "@/lib/format/money";
import type { FinanceQuery, ToolSection } from "@/lib/finance/tools/queries";
import type {
  AttachedFileMap,
  FinanceToolView,
} from "@/lib/finance/tools/views";
import type { FinanceActor } from "@/lib/finance/tools/access";
import type { AttachmentType } from "@/lib/finance/tools-rules";

export function EditPanel({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details
      open={open}
      className="rounded-xl border border-line bg-panel p-4 print:hidden"
    >
      <summary className="flex min-h-11 cursor-pointer items-center text-label text-accent-text">
        {title}
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}
export function AttachedFiles({
  slug,
  type,
  id,
  files,
  editable,
}: {
  slug: string;
  type: AttachmentType;
  id: string;
  files: AttachedFileMap;
  editable: boolean;
}) {
  const rows = files[id] ?? [];
  return (
    <FinanceAttachments
      key={`${id}:${rows.map((r) => r.attachmentId).join(":")}`}
      slug={slug}
      type={type}
      recordId={id}
      initial={rows}
      editable={editable}
    />
  );
}
function Empty({
  text,
  add,
  href = "#add-record",
}: {
  text: string;
  add: string;
  href?: string;
}) {
  return (
    <EmptyState
      patch
      title={text}
      action={
        <a href={href} className={buttonClasses({ variant: "secondary" })}>
          {add}
        </a>
      }
    />
  );
}
export function FinanceToolScreen({
  actor,
  section,
  query,
  view,
}: {
  actor: FinanceActor;
  section: Extract<
    ToolSection,
    "funds" | "budgets" | "bills" | "close" | "disbursements"
  >;
  query: FinanceQuery;
  view: FinanceToolView;
}) {
  const { data, pickers: p, files } = view;
  const slug = actor.workspace.slug,
    base = `/w/${slug}/finance`,
    today = localDate(new Date(), actor.workspace.timezone),
    currency = actor.workspace.currency;
  const manage = data.manage;
  const selectMember = (value: string | null = ""): FormField => ({
    name: "ownerId",
    label: "Owner",
    type: "select",
    options: p.members,
    value: value ?? "",
  });
  const heading = {
    funds: [
      "Funds and cost centres",
      "Keep restricted money and programme spending clear.",
    ],
    budgets: [
      "Budgets",
      "Plan by category and period. Actuals come from the ledger.",
    ],
    bills: ["Supplier bills", "Record bills, due dates and payments."],
    close: [
      "Month-end",
      "Check the month, compare bank balances and sign off.",
    ],
    disbursements: [
      "Disbursements",
      "Record approved payouts and settle staff advances.",
    ],
  }[section];
  const fundFields = (f?: (typeof data.funds)[number]): FormField[] => [
    ...(f ? [hidden("id", f.id)] : []),
    {
      name: "name",
      label: "Fund name",
      value: f?.name,
      required: true,
      maxLength: 120,
    },
    currencyField(f?.currency ?? currency),
    {
      name: "restricted",
      label: "Restricted to a donor's purpose",
      type: "checkbox",
      value: f?.restricted,
    },
    { name: "funder", label: "Donor or funder", value: f?.funder ?? "" },
    { name: "notes", label: "Notes", type: "textarea", value: f?.notes ?? "" },
    ...(f
      ? [
          {
            name: "archived",
            label: "Archive this fund",
            type: "checkbox" as const,
            value: !!f.archivedAt,
          },
        ]
      : []),
  ];
  const budgetFields = (b?: (typeof data.budgets)[number]): FormField[] => [
    ...(b ? [hidden("id", b.id)] : []),
    { name: "name", label: "Budget line", required: true, value: b?.name },
    currencyField(b?.currency ?? currency),
    money(
      "amountMinor",
      "Budget amount",
      b ? minorToDecimalString(b.amountMinor, b.currency) : "",
      true,
    ),
    {
      name: "periodStart",
      label: "Period starts",
      type: "date",
      required: true,
      value: b ? isoDay(b.periodStart) : data.period.from,
    },
    {
      name: "periodEnd",
      label: "Period ends",
      type: "date",
      required: true,
      value: b ? isoDay(b.periodEnd) : data.period.to,
    },
    {
      name: "categoryId",
      label: "Expense category",
      type: "select",
      options: p.categories.filter((c) => c.kind === "EXPENSE"),
      value: b?.categories[0] ?? "",
    },
    {
      name: "costCentreId",
      label: "Cost centre",
      type: "select",
      options: p.centres,
      value: b?.costCentreId ?? "",
    },
    {
      name: "varianceNote",
      label: "Variance note",
      type: "textarea",
      value: b?.varianceNote ?? "",
      helper: "Explain a planned overspend or change in activity.",
    },
  ];
  const billFields = (b?: (typeof data.bills)[number]): FormField[] => [
    ...(b ? [hidden("id", b.id)] : []),
    { name: "vendor", label: "Vendor", required: true, value: b?.vendor },
    { name: "number", label: "Bill number", required: true, value: b?.number },
    {
      name: "issuedOn",
      label: "Bill date",
      type: "date",
      value: b ? isoDay(b.issuedOn) : today,
      required: true,
    },
    {
      name: "dueOn",
      label: "Due date",
      type: "date",
      value: b ? isoDay(b.dueOn) : today,
      required: true,
    },
    currencyField(b?.currency ?? currency),
    money(
      "amountMinor",
      "Amount payable after TDS",
      b ? minorToDecimalString(b.amountMinor, b.currency) : "",
      true,
    ),
    ...tagFields(p, b ?? {}),
    ...taxFields(
      b
        ? Object.fromEntries(
            Object.entries(b).map(([k, v]) => [
              k,
              k.endsWith("Minor") && typeof v === "number"
                ? minorToDecimalString(v, b.currency)
                : v,
            ]),
          )
        : {},
    ),
    selectMember(b?.ownerId),
    { name: "notes", label: "Notes", type: "textarea", value: b?.notes ?? "" },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div>
        <h2 className="text-h2">{heading[0]}</h2>
        <p className="text-body-ui text-ink-muted">{heading[1]}</p>
      </div>
      <FinanceFilters
        query={{ ...query, month: data.period.month }}
        month={section === "close" || section === "budgets"}
        currency={section === "funds" ? currency : undefined}
        statuses={
          section === "bills"
            ? [
                { id: "unpaid", name: "Unpaid" },
                { id: "partly", name: "Partly paid" },
                { id: "paid", name: "Paid" },
                { id: "overdue", name: "Overdue" },
              ]
            : section === "disbursements"
              ? options(["DRAFT", "PENDING", "PAID"])
              : []
        }
      />
      {section === "funds" ? (
        <>
          {data.cashSummary ? (
            <Card>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">
                    Restricted cash ({data.cashSummary.currency})
                  </dt>
                  <dd className="text-h2 tabular-nums">
                    {formatMoney(
                      data.cashSummary.restrictedMinor,
                      data.cashSummary.currency,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-muted">
                    Unrestricted cash ({data.cashSummary.currency})
                  </dt>
                  <dd className="text-h2 tabular-nums">
                    {formatMoney(
                      data.cashSummary.unrestrictedMinor,
                      data.cashSummary.currency,
                    )}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-caption text-ink-muted">
                Opening account balances are unrestricted until tagged income is
                recorded.
              </p>
            </Card>
          ) : null}
          {!data.funds.length ? (
            <Empty
              text="No funds yet. Add one for the next programme."
              add={manage ? "Add a fund" : "Open requests"}
              href={manage ? "#add-record" : `/w/${slug}/requests`}
            />
          ) : null}
          {data.funds.map((f) => (
            <Card key={f.id} id={f.id}>
              <CardHeader
                title={f.name}
                description={f.funder ?? undefined}
                action={
                  <Chip tone={f.restricted ? "warning" : "neutral"}>
                    {f.archivedAt
                      ? "Archived"
                      : f.restricted
                        ? "Restricted"
                        : "Unrestricted"}
                  </Chip>
                }
              />
              <p className="text-h2 tabular-nums">
                {formatMoney(f.balanceMinor, f.currency)}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-body-ui text-ink-muted">
                {f.notes}
              </p>
              <div className="mt-4">
                <AttachedFiles
                  slug={slug}
                  files={files}
                  type="FUND"
                  id={f.id}
                  editable={manage}
                />
              </div>
              {manage ? (
                <div className="mt-4">
                  <EditPanel title="Edit fund">
                    <ToolForm
                      slug={slug}
                      operation="fund"
                      fields={fundFields(f)}
                      button="Save fund"
                    />
                  </EditPanel>
                </div>
              ) : null}
            </Card>
          ))}
          {manage ? (
            <div id="add-record">
              <EditPanel title="Add a fund">
                <ToolForm
                  slug={slug}
                  operation="fund"
                  fields={fundFields()}
                  button="Add fund"
                  reset
                />
              </EditPanel>
            </div>
          ) : null}
          <Card>
            <CardHeader
              title="Cost centres"
              description="Use an event, programme, project or team. External event links are references only."
            />
            {p.centres.length ? (
              <ul className="divide-y divide-line">
                {p.centres.map((c) => (
                  <li key={c.id} className="py-3">
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong>{c.name}</strong>
                      <Chip>{label(c.kind)}</Chip>
                    </div>
                    {c.externalReference ? (
                      <p className="text-ink-muted">{c.externalReference}</p>
                    ) : null}
                    {c.externalUrl ? (
                      <a
                        href={c.externalUrl}
                        rel="noreferrer"
                        target="_blank"
                        className={buttonClasses({ variant: "quiet" })}
                      >
                        Open event reference
                      </a>
                    ) : null}
                    {manage ? (
                      <EditPanel title={`Edit ${c.name}`}>
                        <ToolForm
                          slug={slug}
                          operation="centre"
                          button="Save cost centre"
                          fields={[
                            hidden("id", c.id),
                            {
                              name: "name",
                              label: "Name",
                              required: true,
                              value: c.name,
                            },
                            {
                              name: "kind",
                              label: "Kind",
                              type: "select",
                              options: options(centreKinds),
                              value: c.kind,
                              required: true,
                            },
                            {
                              name: "projectId",
                              label: "Workspace project",
                              type: "select",
                              options: p.projects,
                              value: c.projectId ?? "",
                            },
                            {
                              name: "externalReference",
                              label: "External event reference",
                              value: c.externalReference ?? "",
                            },
                            {
                              name: "externalUrl",
                              label: "External event URL",
                              type: "url",
                              value: c.externalUrl ?? "",
                            },
                            {
                              name: "notes",
                              label: "Notes",
                              type: "textarea",
                              value: c.notes ?? "",
                            },
                            {
                              name: "archived",
                              label: "Archive this cost centre",
                              type: "checkbox",
                            },
                          ]}
                        />
                      </EditPanel>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-muted">
                No cost centres yet. Add one below.
              </p>
            )}
          </Card>
          {manage ? (
            <EditPanel title="Add a cost centre">
              <ToolForm
                slug={slug}
                operation="centre"
                button="Add cost centre"
                reset
                fields={[
                  { name: "name", label: "Name", required: true },
                  {
                    name: "kind",
                    label: "Kind",
                    type: "select",
                    options: options(centreKinds),
                    value: "PROGRAMME",
                    required: true,
                  },
                  {
                    name: "projectId",
                    label: "Workspace project",
                    type: "select",
                    options: p.projects,
                  },
                  {
                    name: "externalReference",
                    label: "External event reference",
                  },
                  {
                    name: "externalUrl",
                    label: "External event URL",
                    type: "url",
                  },
                  { name: "notes", label: "Notes", type: "textarea" },
                ]}
              />
            </EditPanel>
          ) : null}
        </>
      ) : null}
      {section === "budgets" ? (
        <>
          {!data.budgets.length ? (
            <Empty
              text="No budgets yet. Plan a month or a year."
              add={manage ? "Add a budget line" : "Open requests"}
              href={manage ? "#add-record" : `/w/${slug}/requests`}
            />
          ) : null}
          {data.budgets.map((b) => (
            <Card key={b.id} id={b.id}>
              <CardHeader
                title={b.name}
                description={`${formatDay(b.periodStart)} to ${formatDay(b.periodEnd)}`}
                action={
                  <Chip
                    tone={
                      b.actualMinor >= b.amountMinor
                        ? "danger"
                        : b.actualMinor >= b.amountMinor * 0.8
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {b.actualMinor >= b.amountMinor
                      ? "At or over budget"
                      : b.actualMinor >= b.amountMinor * 0.8
                        ? "80% used"
                        : "Within budget"}
                  </Chip>
                }
              />
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {[
                  ["Budget", b.amountMinor],
                  ["Actual", b.actualMinor],
                  ["Remaining", b.amountMinor - b.actualMinor],
                ].map(([name, value]) => (
                  <div key={name}>
                    <dt className="text-ink-muted">{name}</dt>
                    <dd className="text-title tabular-nums">
                      {formatMoney(Number(value), b.currency)}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 whitespace-pre-wrap text-ink-muted">
                {b.varianceNote ?? "No variance note."}
              </p>
              {manage ? (
                <div className="mt-4">
                  <EditPanel title="Edit budget or variance note">
                    <ToolForm
                      slug={slug}
                      operation="budget"
                      fields={budgetFields(b)}
                      button="Save budget"
                    />
                  </EditPanel>
                </div>
              ) : null}
            </Card>
          ))}
          {manage ? (
            <div id="add-record">
              <EditPanel title="Add a budget line">
                <ToolForm
                  slug={slug}
                  operation="budget"
                  fields={budgetFields()}
                  button="Add budget line"
                  reset
                />
              </EditPanel>
            </div>
          ) : null}
        </>
      ) : null}
      {section === "bills" ? (
        <>
          {!data.bills.length ? (
            <Empty
              text="No bills here yet. Log the next supplier bill."
              add={manage ? "Log a bill" : "Open requests"}
              href={manage ? "#add-record" : `/w/${slug}/requests`}
            />
          ) : null}
          {data.bills.map((b) => (
            <Card key={b.id} id={b.id}>
              <CardHeader
                title={`${b.vendor} · ${b.number}`}
                description={`Bill ${formatDay(b.issuedOn)} · Due ${formatDay(b.dueOn)}`}
                action={
                  <Chip
                    tone={
                      b.paidMinor < b.amountMinor && isoDay(b.dueOn) < today
                        ? "danger"
                        : b.paidMinor >= b.amountMinor
                          ? "success"
                          : "warning"
                    }
                  >
                    {b.paidMinor < b.amountMinor && isoDay(b.dueOn) < today
                      ? "Overdue · "
                      : ""}
                    {b.needsActual ? "Needs actual amount" : billStatus(b.amountMinor, b.paidMinor)}
                  </Chip>
                }
              />
              {b.needsActual && manage ? <a className="inline-flex min-h-11 items-center text-accent-text underline" href={`/w/${slug}/finance/dues`}>Enter the actual amount in Upcoming dues</a> : null}
              <p className="text-title">
                {formatMoney(b.amountMinor, b.currency)} total ·{" "}
                {formatMoney(b.amountMinor - b.paidMinor, b.currency)} unpaid
              </p>
              <p className="text-body-ui text-ink-muted">
                {b.purpose}
                {b.gstin ? ` · Tax ID ${b.gstin}` : ""}
                {b.tdsMinor
                  ? ` · TDS ${formatMoney(b.tdsMinor, b.currency)}`
                  : ""}
              </p>
              <p className="whitespace-pre-wrap text-ink-muted">{b.notes}</p>
              <div className="mt-4">
                <AttachedFiles
                  slug={slug}
                  files={files}
                  type="BILL"
                  id={b.id}
                  editable={manage}
                />
              </div>
              {b.payments.length ? (
                <ul
                  className="mt-4 divide-y divide-line"
                  aria-label="Bill payments"
                >
                  {b.payments.map((a) => (
                    <li key={a.id} className="py-2 text-body-ui">
                      {formatDay(a.paidOn)} ·{" "}
                      {formatMoney(a.amountMinor, b.currency)} · {a.reference} ·{" "}
                      {a.posted ? "Posted to ledger" : "Payment recorded only"}
                    </li>
                  ))}
                </ul>
              ) : null}
              {manage && b.paidMinor < b.amountMinor ? (
                <div className="mt-4">
                  <EditPanel title="Record a payment">
                    <ToolForm
                      slug={slug}
                      operation="billPayment"
                      fields={[
                        hidden("billId", b.id),
                        hidden("currency", b.currency),
                        hidden("paymentKey", randomUUID()),
                        money(
                          "amountMinor",
                          "Payment amount",
                          minorToDecimalString(
                            b.amountMinor - b.paidMinor,
                            b.currency,
                          ),
                          true,
                        ),
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
                        {
                          name: "post",
                          label: "Create the ledger expense",
                          type: "checkbox",
                          value: true,
                          helper:
                            "Turn this off only if the payment is already in the ledger.",
                        },
                      ]}
                      button="Record payment"
                    />
                  </EditPanel>
                </div>
              ) : null}
              {manage && b.paidMinor === 0 ? (
                <div className="mt-3">
                  <EditPanel title="Edit bill">
                    <ToolForm
                      slug={slug}
                      operation="bill"
                      fields={billFields(b)}
                      button="Save bill"
                    />
                  </EditPanel>
                </div>
              ) : null}
            </Card>
          ))}
          {manage ? (
            <div id="add-record">
              <EditPanel title="Log a bill">
                <MoneyRecordForm
                  slug={slug}
                  operation="bill"
                  fields={billFields()}
                  button="Save bill"
                />
              </EditPanel>
            </div>
          ) : null}
        </>
      ) : null}
      {section === "close" ? (
        <>
          <Card>
            <CardHeader
              title={`${data.period.month} checklist`}
              action={
                <Chip tone={data.month?.signedOffAt ? "success" : "neutral"}>
                  {data.month?.signedOffAt ? "Signed off" : "Open"}
                </Chip>
              }
            />
            {!data.month ? (
              <>
                <EmptyState
                  patch
                  title={
                    manage
                      ? "No checklist for this month. Start the close."
                      : "No checklist for this month. A finance admin can start it."
                  }
                  action={
                    !manage ? (
                      <Link
                        href={base}
                        className={buttonClasses({ variant: "secondary" })}
                      >
                        Finance overview
                      </Link>
                    ) : undefined
                  }
                />
                {manage ? (
                  <div id="add-record" className="mt-4">
                    <ToolForm
                      slug={slug}
                      operation="monthStart"
                      fields={[hidden("month", data.period.month)]}
                      button="Start month-end checklist"
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <div className="flex flex-col gap-4">
                {data.month.steps.map((step) => (
                  <div
                    key={step.id}
                    className="rounded-lg border border-line p-4"
                  >
                    {manage && !data.month?.signedOffAt ? (
                      <ToolForm
                        slug={slug}
                        operation="step"
                        fields={[
                          hidden("id", step.id),
                          hidden("month", data.period.month),
                          {
                            name: "title",
                            label: "Step",
                            required: true,
                            value: step.title,
                          },
                          selectMember(step.ownerId),
                          {
                            name: "done",
                            label: "Done",
                            type: "checkbox",
                            value: step.done,
                          },
                          {
                            name: "notes",
                            label: "Notes",
                            type: "textarea",
                            value: step.notes ?? "",
                          },
                          {
                            name: "remove",
                            label: "Remove this step",
                            type: "checkbox",
                            helper: "Tick only when this step is not needed.",
                          },
                        ]}
                        button="Save step"
                      />
                    ) : (
                      <>
                        <p>
                          {step.title} · {step.done ? "Done" : "To do"}
                        </p>
                        <p className="text-ink-muted">{step.notes}</p>
                      </>
                    )}
                  </div>
                ))}
                {manage && !data.month.signedOffAt ? (
                  <EditPanel title="Add a checklist step">
                    <ToolForm
                      slug={slug}
                      operation="step"
                      fields={[
                        hidden("month", data.period.month),
                        { name: "title", label: "Step", required: true },
                        selectMember(),
                        { name: "notes", label: "Notes", type: "textarea" },
                      ]}
                      button="Add step"
                    />
                  </EditPanel>
                ) : null}
                {manage ? (
                  <ToolForm
                    slug={slug}
                    operation="close"
                    fields={[
                      hidden("month", data.period.month),
                      hidden(
                        "reopen",
                        data.month.signedOffAt ? "true" : "false",
                      ),
                    ]}
                    button={
                      data.month.signedOffAt ? "Reopen month" : "Sign off month"
                    }
                  />
                ) : null}
                <AttachedFiles
                  slug={slug}
                  files={files}
                  type="MONTH"
                  id={data.month.id}
                  editable={manage}
                />
              </div>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Bank and cash accounts"
              description="Enter statement closing balances manually. No bank connection is needed."
            />
            {p.accounts.length ? (
              <ul className="divide-y divide-line">
                {p.accounts.map((a) => (
                  <li key={a.id} className="py-3">
                    <strong>{a.name}</strong>
                    <p className="text-ink-muted">
                      Opening {formatMoney(a.openingMinor, a.currency)} on{" "}
                      {a.openingOn} · Reconciled up to{" "}
                      {a.reconciledUpTo ?? "Not yet"}
                    </p>
                    <Link
                      href={`${base}/close?month=${data.period.month}&account=${a.id}`}
                      className={buttonClasses({ variant: "quiet" })}
                    >
                      Show entries
                    </Link>
                    {manage ? (
                      <EditPanel title={`Compare ${a.name} with a statement`}>
                        <ToolForm
                          slug={slug}
                          operation="reconcile"
                          fields={[
                            hidden("accountId", a.id),
                            hidden("currency", a.currency),
                            {
                              name: "upTo",
                              label: "Statement date",
                              type: "date",
                              value: data.period.to,
                              required: true,
                            },
                            money(
                              "statementMinor",
                              "Statement closing balance",
                              "",
                              true,
                            ),
                            { name: "notes", label: "Notes", type: "textarea" },
                            {
                              name: "signOff",
                              label: "Sign off this reconciliation",
                              type: "checkbox",
                              helper:
                                "The difference must be zero and every entry must be marked reconciled.",
                            },
                          ]}
                          button="Compare or sign off"
                        />
                      </EditPanel>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ink-muted">
                No accounts yet. Add your bank or cash account below.
              </p>
            )}
          </Card>
          {data.reconciliations.map((r) => (
            <Card key={r.id} id={r.id}>
              <CardHeader
                title={r.account.name}
                description={`Statement up to ${formatDay(r.upTo)}`}
                action={
                  <Chip tone={r.signedOffAt ? "success" : "neutral"}>
                    {r.signedOffAt ? "Signed off" : "Compared"}
                  </Chip>
                }
              />
              <p>
                Statement {formatMoney(r.statementMinor, r.account.currency)} ·
                Ledger {formatMoney(r.ledgerMinor, r.account.currency)}
              </p>
              <p className="text-title">
                Difference{" "}
                {formatMoney(
                  r.statementMinor - r.ledgerMinor,
                  r.account.currency,
                )}
              </p>
              <p className="text-ink-muted">{r.notes}</p>
            </Card>
          ))}
          <Card>
            <CardHeader
              title="Entries to check"
              description="Choose an account above to narrow this list. Payroll entries require payroll access."
            />
            <div className="flex flex-col gap-3">
              {data.accountEntries.map((e) => (
                <div key={e.id} className="rounded-lg border border-line p-3">
                  <p>
                    {formatDay(e.occurredOn)} · {e.description} ·{" "}
                    {formatMoney(e.amountMinor, e.currency)}
                  </p>
                  <p className="text-ink-muted">
                    {e.account?.name ?? "No account - assign one in Spending"} ·{" "}
                    {e.reconciledAt ? "Reconciled" : "Not reconciled"}
                  </p>
                  {manage && e.accountId ? (
                    <ToolForm
                      slug={slug}
                      operation="mark"
                      fields={[
                        hidden("entryId", e.id),
                        hidden("reconciled", e.reconciledAt ? "false" : "true"),
                      ]}
                      button={e.reconciledAt ? "Clear mark" : "Mark reconciled"}
                    />
                  ) : null}
                </div>
              ))}
              {!data.accountEntries.length ? (
                <p className="text-ink-muted">No entries in this period.</p>
              ) : null}
            </div>
          </Card>
          {manage ? (
            <EditPanel title="Add a bank or cash account">
              <ToolForm
                slug={slug}
                operation="account"
                fields={[
                  {
                    name: "name",
                    label: "Account label",
                    required: true,
                    helper:
                      "For example, Office bank ending 1234. Never enter a full account number.",
                  },
                  currencyField(currency),
                  money("openingMinor", "Opening balance"),
                  {
                    name: "openingOn",
                    label: "Opening balance date",
                    type: "date",
                    value: data.period.from,
                    required: true,
                  },
                ]}
                button="Add account"
                reset
              />
            </EditPanel>
          ) : null}
        </>
      ) : null}
      {section === "disbursements" ? (
        <>
          <p className="text-body-ui text-ink-muted">
            Team members submit their own expense claims in{" "}
            <Link href={`/w/${slug}/requests`} className="underline">
              Requests
            </Link>
            . Use this register for other payouts and staff advances.
          </p>
          {!data.disbursements.length ? (
            <Empty
              text="No disbursements yet. Record the next payout."
              add={manage ? "Add a disbursement" : "Open requests"}
              href={manage ? "#add-record" : `/w/${slug}/requests`}
            />
          ) : null}
          {data.disbursements.map((d) => (
            <Card key={d.id} id={d.id}>
              <CardHeader
                title={d.payee}
                description={`${label(d.kind)} · ${d.purpose}`}
                action={
                  <Chip tone={d.status === "PAID" ? "success" : "neutral"}>
                    {label(d.status)}
                  </Chip>
                }
              />
              <p className="text-title">
                {formatMoney(d.amountMinor, d.currency)}
                {d.tdsMinor
                  ? ` · TDS ${formatMoney(d.tdsMinor, d.currency)}`
                  : ""}
              </p>
              <p className="text-ink-muted">
                {d.paidOn
                  ? `Paid ${formatDay(d.paidOn)} · ${d.reference}`
                  : d.dueOn
                    ? `Due ${formatDay(d.dueOn)}`
                    : "Not paid"}
              </p>
              {d.kind === "ADVANCE" ? (
                <p className="mt-2">
                  {d.settledMinor >= d.amountMinor ? "Settled" : "Unsettled"} ·{" "}
                  {formatMoney(d.amountMinor - d.settledMinor, d.currency)} to
                  settle
                </p>
              ) : null}
              <p className="whitespace-pre-wrap text-ink-muted">{d.notes}</p>
              <div className="mt-4">
                <AttachedFiles
                  slug={slug}
                  files={files}
                  type="DISBURSEMENT"
                  id={d.id}
                  editable={manage}
                />
              </div>
              {manage && d.status !== "PAID" ? (
                <div className="mt-4 flex flex-col gap-3">
                  <ToolForm
                    slug={slug}
                    operation="disbursementTransition"
                    fields={[
                      hidden("id", d.id),
                      hidden("transition", "REQUEST_APPROVAL"),
                    ]}
                    button={
                      d.approvalId
                        ? "Refresh or request approval again"
                        : "Request approval"
                    }
                  />
                  <Link
                    href={`/w/${slug}/approvals`}
                    className={buttonClasses({ variant: "quiet" })}
                  >
                    Open approvals
                  </Link>
                  <EditPanel title="Record approved payment">
                    <ToolForm
                      slug={slug}
                      operation="disbursementTransition"
                      fields={[
                        hidden("id", d.id),
                        hidden("transition", "PAY"),
                        hidden("currency", d.currency),
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
                      button="Record payment and post expense"
                    />
                  </EditPanel>
                </div>
              ) : null}
              {manage &&
              d.status === "PAID" &&
              d.kind === "ADVANCE" &&
              d.settledMinor < d.amountMinor ? (
                <div className="mt-4">
                  <EditPanel title="Settle advance">
                    <ToolForm
                      slug={slug}
                      operation="disbursementTransition"
                      fields={[
                        hidden("id", d.id),
                        hidden("transition", "SETTLE"),
                        hidden("currency", d.currency),
                        money(
                          "settledMinor",
                          "Total settled so far",
                          minorToDecimalString(d.amountMinor, d.currency),
                          true,
                        ),
                        {
                          name: "paidOn",
                          label: "Settlement date",
                          type: "date",
                          value: today,
                          required: true,
                        },
                      ]}
                      button="Save settlement"
                    />
                  </EditPanel>
                </div>
              ) : null}
            </Card>
          ))}
          {manage ? (
            <div id="add-record">
              <EditPanel title="Add a disbursement">
                <MoneyRecordForm
                  slug={slug}
                  operation="disbursement"
                  fields={[
                    { name: "payee", label: "Payee", required: true },
                    { name: "purpose", label: "Purpose", required: true },
                    {
                      name: "kind",
                      label: "Payout type",
                      type: "select",
                      options: options(disbursementKinds),
                      value: "OTHER",
                      required: true,
                    },
                    currencyField(currency),
                    money("amountMinor", "Payout amount after TDS", "", true),
                    money("tdsMinor", "TDS withheld"),
                    ...tagFields(p).filter((f) => f.name !== "purpose"),
                    selectMember(),
                    { name: "dueOn", label: "Due date", type: "date" },
                    { name: "notes", label: "Notes", type: "textarea" },
                  ]}
                  button="Save disbursement"
                />
              </EditPanel>
            </div>
          ) : null}
        </>
      ) : null}
      <nav
        aria-label="Finance list pages"
        className="flex flex-wrap justify-between gap-3"
      >
        {data.page > 1 ? (
          <Link
            href={`?${new URLSearchParams({ ...query, page: String(data.page - 1) } as Record<string, string>)}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Previous page
          </Link>
        ) : (
          <span />
        )}
        {data.hasNext ? (
          <Link
            href={`?${new URLSearchParams({ ...query, page: String(data.page + 1) } as Record<string, string>)}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Next page
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
