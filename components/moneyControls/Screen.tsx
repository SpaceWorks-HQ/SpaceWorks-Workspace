import Link from "next/link";
import {
  Card,
  Chip,
  EmptyState,
  PageHeader,
  Callout,
} from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { NavTabs } from "@/components/ui/tabs";
import { ToolFields, type FormField } from "@/components/finance/ToolForm";

import { formatDate } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/money";
import type { ControlsView } from "@/lib/moneyControls/types";
import {
  LABELS,
  SECTIONS,
  words,
  type Section,
  type Kind,
} from "@/lib/moneyControls/rules";
import { controlFields } from "./fields";
import { ControlForm } from "./ControlForm";
import { Proofs, ReconcileMovement } from "./Proofs";
const TITLES: Record<Section, string> = {
  cash: "Petty cash and transfers",
  assets: "Assets and depreciation",
  tds: "TDS certificates and filings",
  funds: "Restricted fund checks",
};
const DESCRIPTIONS: Record<Section, string> = {
  cash: "Record cash, count it, hand it over and keep deposits separate from spending.",
  assets:
    "Keep the existing equipment register tied to costs, verification and people.",
  tds: "Log deductions and retain official certificates and filing acknowledgements.",
  funds: "Check grant eligibility and review commitments alongside actual use.",
};
export function ControlsScreen({ view }: { view: ControlsView }) {
  const { actor, section, data, p, summary, editing, newKind, edit, today } =
    view;
  const base = `/w/${actor.workspace.slug}/money-controls`,
    timezone = actor.workspace.timezone;
  const kind =
    editing?.kind ??
    (newKind && SECTIONS[section].includes(newKind as Kind)
      ? (newKind as Kind)
      : SECTIONS[section][0]);
  const mutable =
    editing &&
    (editing.status === "DRAFT" ||
      ["FLOAT", "ASSET_CATEGORY", "FUND_RULE"].includes(kind));
  const fields = controlFields(
    kind,
    p,
    actor.workspace.currency,
    today,
    editing,
  );
  const filterFields: FormField[] = [
    { name: "q", label: "Find a record", value: data.q.q },
    {
      name: "kind",
      label: "Record type",
      type: "select",
      value: data.q.kind,
      options: SECTIONS[section].map((id) => ({ id, name: LABELS[id] })),
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      value: data.q.status,
      options: [
        "DRAFT",
        "ACTIVE",
        "PENDING",
        "POSTED",
        "CONFIRMED",
        "ASSIGNED",
        "RETURNED",
        "PARTLY_RETURNED",
        "RECORDED",
        "PREPARED",
        "SUBMITTED",
        "ACCEPTED",
        "PAID",
        "CANCELLED",
      ].map((id) => ({ id, name: words(id) })),
    },
    {
      name: "owner",
      label: "Owner",
      type: "select",
      value: data.q.owner,
      options: p.members,
    },
    { name: "from", label: "From date", type: "date", value: data.q.from },
    { name: "to", label: "To date", type: "date", value: data.q.to },
  ];
  if (section === "funds")
    filterFields.push({
      name: "fundId",
      label: "Fund / grant",
      type: "select",
      value: data.q.fundId,
      options: p.funds,
    });
  if (section === "tds")
    filterFields.push(
      {
        name: "fiscalYear",
        label: "Financial year starting",
        value: String(data.q.fiscalYear),
      },
      {
        name: "quarter",
        label: "Quarter",
        type: "select",
        value: data.q.quarter,
        options: ["Q1", "Q2", "Q3", "Q4", "ANNUAL"].map((id) => ({
          id,
          name: id,
        })),
      },
    );
  const params = new URLSearchParams(
    Object.entries(data.q)
      .filter(([k]) => k !== "section" && k !== "page")
      .map(([k, v]) => [k, String(v)]),
  );
  const name = (id: string | null) =>
    p.members.find((m) => m.id === id)?.name ?? "Former member";
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={TITLES[section]}
        description={DESCRIPTIONS[section]}
        actions={
          <Link
            href={`${base}/export/${section}?${params}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Export CSV
          </Link>
        }
      />
      <NavTabs
        label="Money controls"
        items={(Object.keys(SECTIONS) as Section[]).map((s) => ({
          href: `${base}/${s}`,
          label: TITLES[s],
          active: s === section,
        }))}
      />
      <p className="text-caption text-ink-muted">
        Manual records · Dates use {timezone}.{" "}
        <Link
          className="text-accent-text underline"
          href={`/w/${actor.workspace.slug}/finance`}
        >
          Open finance
        </Link>
        {section === "assets" ? (
          <>
            {" "}
            ·{" "}
            <Link
              className="text-accent-text underline"
              href={`/w/${actor.workspace.slug}/assets`}
            >
              Equipment register
            </Link>
          </>
        ) : null}
      </p>
      {summary.balances.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {summary.balances.map((a) => (
            <Card key={a.id}>
              <h2 className="text-label">{a.name}</h2>
              <p className="text-title">
                {formatMoney(a.balanceMinor, a.currency)}
              </p>
              <p className="text-caption text-ink-muted">
                Current balance, including transfers and deposits
              </p>
            </Card>
          ))}
        </div>
      ) : null}
      {section === "assets" ? (
        <Card>
          <h2 className="mb-3 text-title">Fixed-asset schedule</h2>
          <form className="mb-4 flex flex-wrap items-end gap-3">
            <ToolFields
              fields={[
                {
                  name: "fiscalYear",
                  label: "Financial year starting",
                  value: String(data.q.fiscalYear),
                },
              ]}
            />
            <button className={buttonClasses({ variant: "secondary" })}>
              Show year
            </button>
          </form>
          <p className="mb-4 text-caption text-ink-muted">
            Daily-prorated book depreciation. Category rates are captured when
            the schedule is saved. Income-tax block notes are separate.
          </p>
          <div
            role="region"
            aria-label="Fixed asset schedule"
            tabIndex={0}
            className="overflow-x-auto"
          >
            <table className="w-full text-left text-body-ui">
              <caption className="sr-only">
                Financial year {data.q.fiscalYear} to {data.q.fiscalYear + 1}
              </caption>
              <thead>
                <tr>
                  {[
                    "Asset",
                    "Cost",
                    "Opening value",
                    "Depreciation",
                    "Disposal book value",
                    "Closing value",
                  ].map((h) => (
                    <th
                      scope="col"
                      key={h}
                      className="whitespace-nowrap border-b border-line p-3"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summary.schedules.map((r) => (
                  <tr key={r.id}>
                    <th
                      scope="row"
                      className="border-b border-line p-3 font-medium"
                    >
                      {r.title}
                    </th>
                    {[
                      r.costMinor,
                      r.openingMinor,
                      r.depreciationMinor,
                      r.disposalMinor,
                      r.closingMinor,
                    ].map((v, i) => (
                      <td
                        key={i}
                        className="whitespace-nowrap border-b border-line p-3"
                      >
                        {formatMoney(v, r.currency)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!summary.schedules.length ? (
            <p className="mt-3 text-body-ui">
              Confirm a fixed asset to add it to the schedule.
            </p>
          ) : null}
        </Card>
      ) : null}
      {summary.funds.map((f) => (
        <Card key={f.id}>
          <h2 className="text-title">{f.title}</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["Eligible budget", f.budgetMinor],
              ["Committed and posted", f.committedMinor],
              ["Remaining eligible", f.remainingMinor],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-caption text-ink-muted">{k}</dt>
                <dd className="text-label">
                  {formatMoney(Number(v), f.currency)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="my-3 text-caption text-ink-muted">
            Unpaid bills and unposted pay/disbursement records reserve the
            budget. Their payments replace reservations. Payroll appears only in
            aggregate.
          </p>
          {f.issues.map((s) => (
            <Callout key={s} tone="warning">
              {s}
            </Callout>
          ))}
          <details className="mt-4">
            <summary className="min-h-11 cursor-pointer text-label">
              Fund utilisation statement
            </summary>
            <ul className="space-y-2">
              {summary.utilisation
                .filter((r) => r.fundId === f.fundId)
                .map((r, i) => (
                  <li
                    key={i}
                    className="flex flex-wrap justify-between gap-2 border-b border-line py-2"
                  >
                    <span>
                      {words(r.kind)} ·{" "}
                      {p.categories.find((c) => c.id === r.categoryId)?.name ??
                        "Uncategorised"}
                    </span>
                    <span>
                      {formatMoney(r._sum.amountMinor ?? 0, r.currency)}
                    </span>
                  </li>
                ))}
            </ul>
          </details>
        </Card>
      ))}
      <Card>
        <details
          open={Boolean(editing) || Boolean(newKind) || data.total === 0}
          id="record-editor"
        >
          <summary className="min-h-11 cursor-pointer text-title">
            {editing ? `${LABELS[kind]}: ${editing.title}` : "Add a record"}
          </summary>
          {data.manage ? (
            <>
              <nav
                aria-label="Choose record type"
                className="my-4 flex flex-wrap gap-2"
              >
                {SECTIONS[section].map((k) => (
                  <Link
                    key={k}
                    href={`${base}/${section}?new=${k}#record-editor`}
                    aria-current={!editing && kind === k ? "page" : undefined}
                    className={buttonClasses({
                      variant: !editing && kind === k ? "secondary" : "quiet",
                    })}
                  >
                    {LABELS[k]}
                  </Link>
                ))}
              </nav>
              {!editing || mutable ? (
                <ControlForm
                  key={`${editing?.id ?? "new"}:${kind}`}
                  slug={actor.workspace.slug}
                  fields={fields}
                  hidden={{ kind, id: editing?.id ?? "" }}
                  categories={kind === "FUND_RULE" ? p.categories : undefined}
                  selected={
                    kind === "FUND_RULE"
                      ? ((editing?.details as { allowedCategoryIds?: string[] })
                          ?.allowedCategoryIds ?? [])
                      : []
                  }
                  label={
                    editing
                      ? "Save changes"
                      : `Save ${LABELS[kind].toLowerCase()}`
                  }
                />
              ) : (
                <p className="mb-4 text-body-ui">
                  This record is confirmed. Its facts and evidence history are
                  retained below.
                </p>
              )}
              <p className="mt-4 text-caption text-ink-muted">
                Save a draft, attach its proof, then confirm it. Cash accounts
                are created in Finance → Month-end. A float is a target, not an
                extra cash opening balance.
              </p>
            </>
          ) : (
            <p className="text-body-ui">
              Your assignments and custodian handovers appear below.
            </p>
          )}
        </details>
      </Card>
      <Card>
        <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ToolFields fields={filterFields} />
          <div className="flex flex-wrap gap-2">
            <button className={buttonClasses({ variant: "secondary" })}>
              Filter records
            </button>
            <Link
              href={`${base}/${section}`}
              className={buttonClasses({ variant: "quiet" })}
            >
              Clear
            </Link>
          </div>
        </form>
      </Card>
      {!data.rows.length ? (
        <EmptyState
          patch
          title="No records here yet."
          action={
            <Link
              href={
                data.manage
                  ? `${base}/${section}#record-editor`
                  : `/w/${actor.workspace.slug}/assets`
              }
              className={buttonClasses()}
            >
              {data.manage ? "Add a record" : "Open equipment"}
            </Link>
          }
        />
      ) : null}
      {data.rows.map((r) => {
        const d = r.details as Record<string, unknown>,
          editable = data.manage && (!r.payroll || data.payrollManage),
          draft = r.status === "DRAFT",
          personalHandover =
            r.kind === "HANDOVER" && ["DRAFT", "PENDING"].includes(r.status);
        const actions: string[] = [];
        if (
          editable &&
          draft &&
          ![
            "FLOAT",
            "ASSET_CATEGORY",
            "FUND_RULE",
            "HANDOVER",
            "REPLENISHMENT",
          ].includes(r.kind)
        )
          actions.push("POST");
        if (
          editable &&
          r.kind === "REPLENISHMENT" &&
          ["DRAFT", "PENDING"].includes(r.status)
        )
          actions.push("REQUEST", ...(r.status === "PENDING" ? ["POST"] : []));
        if (
          personalHandover &&
          d.outgoingId === actor.user.id &&
          !d.signedOutAt
        )
          actions.push("SIGN_OUT");
        if (personalHandover && r.ownerId === actor.user.id && d.signedOutAt)
          actions.push("SIGN_IN");
        if (
          editable &&
          ((r.kind === "DEPOSIT" &&
            ["POSTED", "PARTLY_RETURNED"].includes(r.status)) ||
            (r.kind === "ASSIGNMENT" && r.status === "ASSIGNED"))
        )
          actions.push("RETURN");
        if (
          r.kind === "ASSIGNMENT" &&
          r.status === "ASSIGNED" &&
          r.ownerId === actor.user.id &&
          !d.acknowledgedAt
        )
          actions.push("ACKNOWLEDGE");
        if (
          editable &&
          r.kind === "FILING" &&
          ["PREPARED", "SUBMITTED", "ACCEPTED"].includes(r.status)
        )
          actions.push(
            r.status === "PREPARED"
              ? "SUBMITTED"
              : r.status === "SUBMITTED"
                ? "ACCEPTED"
                : "PAID",
          );
        if (editable && ["DRAFT", "PENDING"].includes(r.status))
          actions.push("CANCEL");
        const actionLabel = (op: string) =>
          ({
            POST:
              r.kind === "FILING"
                ? "Mark prepared"
                : r.kind === "REPLENISHMENT"
                  ? "Record approved replenishment"
                  : "Confirm record",
            REQUEST: "Request approval",
            RETURN:
              r.kind === "DEPOSIT"
                ? "Record deposit return"
                : "Return equipment",
            SIGN_IN: "Sign as incoming custodian",
            SIGN_OUT: "Sign as outgoing custodian",
            ACKNOWLEDGE: "Acknowledge receipt",
            CANCEL: "Cancel unconfirmed record",
          })[op] ?? `Mark ${words(op).toLowerCase()}`;
        return (
          <Card key={r.id} id={r.id} className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="break-words text-title">
                  {r.number ? `CV-${String(r.number).padStart(5, "0")} · ` : ""}
                  {r.title}
                </h2>
                <p className="mt-1 text-body-ui text-ink-muted">
                  {LABELS[r.kind]} · {formatDate(r.occurredOn, "UTC")}
                  {r.ownerId ? ` · ${name(r.ownerId)}` : ""}
                </p>
              </div>
              <Chip>{words(r.status)}</Chip>
            </div>
            {r.amountMinor ? (
              <p className="my-3 text-label">
                {formatMoney(r.amountMinor, r.currency)}
                {r.kind === "DEPOSIT"
                  ? ` · Outstanding ${formatMoney(r.amountMinor - r.settledMinor, r.currency)}`
                  : ""}
              </p>
            ) : null}
            {r.dueOn ? (
              <p className="my-2 text-body-ui">
                Due {formatDate(r.dueOn, "UTC")} · Reminder {r.reminderDays}{" "}
                days before
              </p>
            ) : null}
            {r.notes ? (
              <p className="my-3 whitespace-pre-wrap break-words text-body-ui">
                {r.notes}
              </p>
            ) : null}
            <dl className="my-3 grid gap-2 text-body-ui sm:grid-cols-2">
              {[
                ["Account", p.accounts.find((a) => a.id === r.accountId)?.name],
                [
                  r.kind === "TRANSFER" ? "To account" : "Other account",
                  p.accounts.find((a) => a.id === r.otherAccountId)?.name,
                ],
                ["Equipment", p.assets.find((a) => a.id === r.assetId)?.name],
                ["Fund / grant", p.funds.find((a) => a.id === r.fundId)?.name],
                [
                  "Category",
                  p.categories.find((a) => a.id === r.categoryId)?.name,
                ],
                [
                  "Matched deduction",
                  p.records.find((a) => a.id === r.parentId)?.title,
                ],
              ]
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-caption text-ink-muted">{label}</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}

              {[
                "payee",
                "section",
                "fiscalYear",
                "quarter",
                "direction",
                "form",
                "certificateNumber",
                "deliveredOn",
                "condition",
                "method",
                "fundingSource",
                "denominations",
                "returnedOn",
                "returnCondition",
              ]
                .filter((k) => d[k])
                .map((k) => (
                  <div key={k}>
                    <dt className="text-caption text-ink-muted">
                      {words(k.replace(/([A-Z])/g, " $1"))}
                    </dt>
                    <dd className="break-words whitespace-pre-wrap">
                      {k.endsWith("On")
                        ? formatDate(String(d[k]), "UTC")
                        : String(d[k])}
                    </dd>
                  </div>
                ))}
              {d.expectedMinor !== undefined ? (
                <>
                  <div>
                    <dt>Expected cash</dt>
                    <dd>{formatMoney(Number(d.expectedMinor), r.currency)}</dd>
                  </div>
                  <div>
                    <dt>Difference</dt>
                    <dd>
                      {formatMoney(Number(d.differenceMinor), r.currency)}
                    </dd>
                  </div>
                </>
              ) : null}
            </dl>
            {r.complianceId ? (
              <Link
                href={`/w/${actor.workspace.slug}/governance?edit=${r.complianceId}`}
                className="inline-flex min-h-11 items-center text-accent-text underline"
              >
                Compliance calendar
              </Link>
            ) : null}
            {r.checklistRunId ? (
              <Link
                href={`/w/${actor.workspace.slug}/onboarding?run=${r.checklistRunId}`}
                className="inline-flex min-h-11 items-center text-accent-text underline"
              >
                Onboarding / offboarding checklist
              </Link>
            ) : null}
            {r.kind === "REPLENISHMENT" && r.status === "PENDING" ? (
              <Link
                href={`/w/${actor.workspace.slug}/requests/approvals`}
                className="inline-flex min-h-11 items-center text-accent-text underline"
              >
                Review approval in Requests
              </Link>
            ) : null}
            {editable &&
            (draft ||
              ["FLOAT", "ASSET_CATEGORY", "FUND_RULE"].includes(r.kind)) ? (
              <Link
                href={`${base}/${section}?edit=${r.id}#record-editor`}
                className={buttonClasses({ variant: "quiet" })}
              >
                Edit details
              </Link>
            ) : null}
            <details className="mt-3" open={edit === r.id}>
              <summary className="min-h-11 cursor-pointer text-label">
                Proof and history
              </summary>
              <Proofs
                slug={actor.workspace.slug}
                recordId={r.id}
                files={r.files}
                editable={editable}
                removable={draft}
              />
              <ol className="mt-4 space-y-2 text-caption text-ink-muted">
                {r.events.map((e) => (
                  <li key={e.id}>
                    {formatDate(e.createdAt, timezone)} · {words(e.action)} ·{" "}
                    {name(e.actorId)}
                    {e.reference ? ` · ${e.reference}` : ""}
                    {e.notes ? ` · ${e.notes}` : ""}
                  </li>
                ))}
              </ol>
            </details>
            {r.movements.length ? (
              <details className="mt-3">
                <summary className="min-h-11 cursor-pointer text-label">
                  Account movements
                </summary>
                <ul>
                  {r.movements.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3"
                    >
                      <span>
                        {p.accounts.find((a) => a.id === m.accountId)?.name ??
                          "Account"}{" "}
                        · {formatDate(m.occurredOn, "UTC")} ·{" "}
                        {formatMoney(m.amountMinor, m.currency)} · {m.reference}
                      </span>
                      {m.reconciledAt ? (
                        <Chip>Reconciled</Chip>
                      ) : editable ? (
                        <ReconcileMovement
                          slug={actor.workspace.slug}
                          id={m.id}
                        />
                      ) : (
                        <Chip>Unchecked</Chip>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
            {actions.length ? (
              <details className="mt-4">
                <summary className="min-h-11 cursor-pointer text-label">
                  Record the next step
                </summary>
                <div className="flex flex-col gap-5">
                  {actions.map((op) => (
                    <ControlForm
                      key={op}
                      transition
                      slug={actor.workspace.slug}
                      label={actionLabel(op)}
                      hidden={{ id: r.id, operation: op }}
                      fields={[
                        {
                          name: "occurredOn",
                          label:
                            op === "RETURN" ? "Return date" : "Action date",
                          type: "date",
                          value: today,
                          required: true,
                        },
                        {
                          name: "reference",
                          label: "Acknowledgement / payment reference",
                          required: ![
                            "ACKNOWLEDGE",
                            "CANCEL",
                            "REQUEST",
                            "SIGN_IN",
                            "SIGN_OUT",
                          ].includes(op),
                        },
                        ...(op === "RETURN" && r.kind === "DEPOSIT"
                          ? [
                              {
                                name: "amountMinor",
                                label: "Returned amount",
                                type: "money" as const,
                                required: true,
                              },
                            ]
                          : []),
                        {
                          name: "notes",
                          label:
                            op === "RETURN" && r.kind === "ASSIGNMENT"
                              ? "Return condition"
                              : "Notes / difference explanation",
                          type: "textarea",
                          required: op === "RETURN" && r.kind === "ASSIGNMENT",
                        },
                      ]}
                    />
                  ))}
                </div>
              </details>
            ) : null}
          </Card>
        );
      })}
      <nav
        aria-label="Record pages"
        className="flex flex-wrap items-center gap-3"
      >
        <p className="text-caption">
          {data.total} records · Page {data.q.page}
        </p>
        {data.q.page > 1 ? (
          <Link
            href={`?${params}&page=${data.q.page - 1}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Previous
          </Link>
        ) : null}
        {data.q.page * 40 < data.total ? (
          <Link
            href={`?${params}&page=${data.q.page + 1}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Next
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
