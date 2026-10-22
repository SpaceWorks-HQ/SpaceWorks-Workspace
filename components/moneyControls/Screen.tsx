import Link from "next/link";
import {
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import { NavTabs } from "@/components/ui/tabs";
import { ToolFields } from "@/components/finance/ToolForm";
import type { ControlsView } from "@/lib/moneyControls/types";
import {
  SECTIONS,
  type Section,
} from "@/lib/moneyControls/rules";
import { ControlSummary } from "./ControlSummary";
import { ControlEditor } from "./ControlEditor";
import { ControlRecordCard } from "./ControlRecordCard";
import { controlFilterFields } from "./filterFields";

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
  const { actor, section, data } = view;
  const base = `/w/${actor.workspace.slug}/money-controls`,
    timezone = actor.workspace.timezone;
  const filterFields = controlFilterFields(view);
  const params = new URLSearchParams(
    Object.entries(data.q)
      .filter(([k]) => k !== "section" && k !== "page")
      .map(([k, v]) => [k, String(v)]),
  );
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
      <ControlSummary view={view} />
      <ControlEditor view={view} />
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
      {data.rows.map((r) => (
        <ControlRecordCard key={r.id} view={view} r={r} />
      ))}
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
