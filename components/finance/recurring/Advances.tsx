import { Field, Input, Dropdown } from "@/components/ui/field";
import Link from "next/link";
import { Card, PageHeader, EmptyState, Chip } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { FinanceAttachments } from "@/components/finance/FinanceAttachments";
import { RecurringForm } from "./Forms";
import {
  hidden,
  select,
  text,
  CostNav,
  PageLinks,
} from "./Screen";
import type {
  AdvancesView,
  RecurringQuery,
} from "@/lib/finance/recurring/queries";
import { formatMoney } from "@/lib/format/money";
import { AdvanceRecoveries } from "./AdvanceRecoveries";
export function AdvancesScreen({
  slug,
  view,
  today,
  query = {},
}: {
  slug: string;
  view: AdvancesView;
  today: string;
  query?: RecurringQuery;
}) {
  return (
    <div className="mx-auto flex max-w-5xl min-w-0 flex-col gap-6 p-4 sm:p-6">
      <PageHeader titleAs="h2"
        title="Staff advances and loans"
        description="Private advances, independent approval and dated recoveries. Cash stays in the existing Money controls accounts."
      />
      <CostNav
        slug={slug}
        finance={view.financeManage}
        payroll={view.payrollView}
      />
      <a
        className="min-h-11 py-3 text-accent-text underline"
        href={`/w/${slug}/finance/recurring/export?${new URLSearchParams({ ...query, export: "advances" })}`}
      >
        Export advances CSV
      </a>
      <form className="grid gap-3 sm:grid-cols-4">
        <Field label="Search reason">
          <Input name="q" defaultValue={query.q} />
        </Field>
        <Field label="Status">
          <Dropdown name="status" defaultValue={query.status ?? ""}>
            <option value="">All statuses</option>
            {["DRAFT", "PENDING", "PAID", "CANCELLED"].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Dropdown>
        </Field>
        {view.manage ? (
          <Field label="Person">
            <Dropdown name="person" defaultValue={query.person ?? ""}>
              <option value="">All people</option>
              {view.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Dropdown>
          </Field>
        ) : null}
        <button className={buttonClasses({ variant: "secondary" })}>
          Apply filters
        </button>
      </form>
      {view.rows.length ? (
        <ul className="space-y-5">
          {view.rows.map((r) => (
            <li key={r.id}>
              <Card>
                <div className="flex flex-wrap justify-between gap-3">
                  <h2 className="break-words text-lg font-semibold">
                    {view.profiles.find((p) => p.id === r.profileId)?.name ??
                      "Staff advance"}
                  </h2>
                  <Chip>
                    {r.status === "PAID"
                      ? "Paid to staff"
                      : r.status === "PENDING"
                        ? "Approval requested"
                        : r.status === "CANCELLED"
                          ? "Cancelled"
                          : "Draft"}
                  </Chip>
                </div>
                <p className="mt-3 whitespace-pre-wrap break-words">
                  {r.reason}
                </p>
                <p className="mt-3">
                  {formatMoney(r.amountMinor, r.currency)} · Outstanding{" "}
                  {formatMoney(
                    r.amountMinor -
                      r.recoveries.reduce((n, v) => n + v.recoveredMinor, 0),
                    r.currency,
                  )}{" "}
                  · {r.instalments} instalments
                </p>
                <div className="mt-4">
                  <FinanceAttachments
                    slug={slug}
                    type="ADVANCE"
                    recordId={r.id}
                    initial={view.files[r.id] ?? []}
                    editable={view.manage}
                  />
                </div>
                {view.manage && !["PAID", "CANCELLED"].includes(r.status) ? (
                  <div className="mt-5 grid gap-5 sm:grid-cols-2">
                    <RecurringForm
                      slug={slug}
                      operation="approval"
                      fields={[
                        hidden("id", r.id),
                        select(
                          "approverId",
                          "Independent payroll manager",
                          view.people.filter((p) => p.id !== r.userId),
                          "",
                          true,
                        ),
                      ]}
                      button="Request approval"
                    />
                    <RecurringForm
                      slug={slug}
                      operation="advancePay"
                      fields={[
                        hidden("id", r.id),
                        text("paidOn", "Paid on", today, "date", true),
                        text(
                          "reference",
                          "Payment reference",
                          "",
                          "text",
                          true,
                        ),
                      ]}
                      button="Record approved payout"
                    />
                  </div>
                ) : null}
                {view.manage && !["PAID", "CANCELLED"].includes(r.status) ? (
                  <div className="mt-4">
                    <RecurringForm
                      slug={slug}
                      operation="advanceCancel"
                      fields={[hidden("id", r.id)]}
                      button="Cancel unpaid advance"
                    />
                  </div>
                ) : null}
                {r.approvalId ? (
                  <Link
                    className="inline-flex min-h-11 items-center text-accent-text underline"
                    href={`/w/${slug}/requests/approvals`}
                  >
                    Review approval in Requests
                  </Link>
                ) : null}
                <AdvanceRecoveries
                  slug={slug}
                  view={view}
                  r={r}
                  today={today}
                />
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          patch="idle"
          title="No staff advances yet."
          action={
            view.manage ? (
              <Link
                className={buttonClasses({ variant: "primary" })}
                href="#add-advance"
              >
                Add an advance
              </Link>
            ) : (
              <Link
                className={buttonClasses({ variant: "primary" })}
                href={`/w/${slug}/requests`}
              >
                Open requests
              </Link>
            )
          }
        />
      )}
      <PageLinks
        base={`/w/${slug}/finance/advances`}
        query={query}
        page={view.page}
        total={view.total}
      />
      {view.manage && view.pickers ? (
        <Card id="add-advance">
          <h2 className="mb-4 text-xl font-semibold">
            Add an advance or staff loan
          </h2>
          <p className="mb-4 text-sm text-ink-secondary">
            Use the pay profile’s currency. Attach payment proof and obtain an
            independent approval before recording the payout.
          </p>
          <RecurringForm
            slug={slug}
            operation="advance"
            fields={[
              hidden("requestKey", crypto.randomUUID()),
              select("profileId", "Pay profile", view.profiles, "", true),
              text("amountMinor", "Advance amount", "", "money", true),
              text("reason", "Reason", "", "textarea", true),
              text(
                "instalments",
                "Number of monthly instalments",
                "4",
                "text",
                true,
              ),
              text("startsOn", "First recovery due", today, "date", true),
              select(
                "accountId",
                "Cash / bank account",
                view.pickers.accounts,
                "",
                true,
              ),
              select("fundId", "Fund", view.pickers.funds),
              select("costCentreId", "Cost centre", view.pickers.centres),
            ]}
            button="Save advance"
          />
        </Card>
      ) : null}
    </div>
  );
}
