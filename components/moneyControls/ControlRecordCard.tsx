import Link from "next/link";
import {
  Card,
  Chip,
} from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { formatDate } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/money";
import type { ControlsView } from "@/lib/moneyControls/types";
import {
  LABELS,
  words,
} from "@/lib/moneyControls/rules";
import type { ControlRow } from "@/lib/moneyControls/types";
import { controlRecordActions } from "./recordActions";
import { ControlRecordHistory } from "./ControlRecordHistory";

export function ControlRecordCard({ view, r }: {
  view: ControlsView;
  r: ControlRow;
}) {
  const { actor, data, p, section } = view;
  const base = `/w/${actor.workspace.slug}/money-controls`;
  const name = (id: string | null) =>
    p.members.find((m) => m.id === id)?.name ?? "Former member";

  const d = r.details as Record<string, unknown>,
    editable = data.manage && (!r.payroll || data.payrollManage),
    draft = r.status === "DRAFT",
    personalHandover =
      r.kind === "HANDOVER" && ["DRAFT", "PENDING"].includes(r.status);
  const { actions, actionLabel } = controlRecordActions(
    r, d, editable, draft, personalHandover, actor,
  );
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
      <ControlRecordHistory
        view={view}
        r={r}
        editable={editable}
        draft={draft}
        actions={actions}
        actionLabel={actionLabel}
      />
    </Card>
  );
}
