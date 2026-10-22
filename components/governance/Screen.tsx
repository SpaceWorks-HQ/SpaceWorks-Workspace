import Link from "next/link";
import type { GovernanceData, Actor, Filters } from "@/lib/governance/service";
import {
  LABELS,
  STATUSES,
  SECTIONS,
  label,
  sectionPath,
  type Section,
} from "@/lib/governance/schemas";
import { type Choices } from "@/lib/governance/fields";
import {
  RecordForm,
  AgmForm,
  type EditRecord,
} from "./Forms";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card, Callout } from "@/components/ui/display";
import { SelectedRecord } from "./SelectedRecord";
import { RecordList } from "./RecordList";
const TITLES = {
  compliance: "Compliance calendar",
  board: "Board and committees",
  vendors: "Vendors and contracts",
  registers: "Insurance and registers",
  risk: "Risks and emergency plans",
  reviews: "SOP reviews",
  packs: "Board packs",
};
const DESCRIPTIONS = {
  compliance: "Keep legal details, filing dates and proof in one place.",
  board: "Keep terms, declarations, minutes and resolutions together.",
  vendors: "Keep vendor details, contracts and notice dates ready for review.",
  registers: "Track cover, expiry and statutory register snapshots.",
  risk: "Assess risks, record controls and practise emergency plans.",
  reviews: "Keep policies current and review overdue documents.",
  packs: "Review a period, then freeze its reports and evidence.",
};
export function GovernanceScreen({
  actor,
  section,
  params,
  data,
}: {
  actor: Actor;
  data: GovernanceData;
  section: Section;
  params: Record<string, string | string[] | undefined>;
}) {
  const filters: Filters = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      typeof v === "string" ? v : undefined,
    ]),
  );
  const slug = actor.workspace.slug,
    base = `/w/${slug}/governance${sectionPath(section)}`;
  const choices: Choices = {
    owners: data.owners.map((m) => ({
      value: m.user.id,
      label: m.user.name ?? "Former member",
    })),
    committees: data.committees.map((c) => ({ value: c.id, label: c.title })),
    organisations: data.organisations.map((o) => ({
      value: o.id,
      label: o.name,
    })),
    vendors: data.vendors.map((v) => ({ value: v.id, label: v.title })),
    meetings: data.meetings.map((m) => ({ value: m.id, label: m.title })),
    ...(Object.fromEntries(
      (
        [
          "docs",
          "obligations",
          "entities",
          "plans",
          "decisions",
          "evidence",
        ] as const
      ).map((k) => [k, data[k].map((c) => ({ value: c.id, label: c.title }))]),
    ) as Pick<
      Choices,
      "docs" | "obligations" | "entities" | "plans" | "decisions" | "evidence"
    >),
    contacts: data.contacts.map((c) => ({ value: c.id, label: c.displayName })),
  };
  const r = data.selected;
  const details = r?.details as Record<string, unknown> | undefined;
  const selected: EditRecord | undefined = r
    ? {
        ...r,
        dueOn: r.dueOn?.toISOString().slice(0, 10) ?? "",
        startsOn: r.startsOn?.toISOString().slice(0, 10) ?? "",
        endsOn: r.endsOn?.toISOString().slice(0, 10) ?? "",
        details: details!,
      }
    : undefined;
  const statusChoices = [
    ...new Set(SECTIONS[section].flatMap((k) => STATUSES[k])),
  ];
  const query = new URLSearchParams(
    Object.entries(filters).filter(
      ([k, v]) => typeof v === "string" && !["edit", "new"].includes(k),
    ) as [string, string][],
  );
  function pageHref(page: number) {
    const q = new URLSearchParams(query);
    q.set("page", String(page));
    return `${base}?${q}`;
  }
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="space-y-2">
        <p className="text-caption text-ink-muted">Governance · Admins only</p>
        <h1 className="text-h1">{TITLES[section]}</h1>
        <p className="text-ink-muted">{DESCRIPTIONS[section]}</p>
      </header>
      <nav
        aria-label="Governance tools"
        className="flex flex-wrap gap-x-6 border-b border-line"
      >
        {(Object.keys(SECTIONS) as Section[]).map((s) => (
          <Link
            key={s}
            href={`/w/${slug}/governance${sectionPath(s)}`}
            aria-current={s === section ? "page" : undefined}
            className={`min-h-11 py-3 ${s === section ? "border-b-2 border-accent text-accent-text" : "text-ink-muted"}`}
          >
            {TITLES[s]}
          </Link>
        ))}
      </nav>
      <Link
        href={`/w/${slug}/safeguarding`}
        className="inline-flex min-h-11 items-center text-accent-text underline"
      >
        Confidential safeguarding
      </Link>
      {section === "compliance" ? (
        <Callout title="Verify with your CA">
          These are manual planning tools. Confirm applicability, current forms
          and deadlines with your CA; tax-year rules and state requirements can
          change.
        </Callout>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href={`${base}?new=1#record-form`}>Add record</Link>
        </Button>
        <Button asChild variant="secondary">
          <a href={`/w/${slug}/governance/export?section=${section}&${query}`}>
            Export filtered CSV
          </a>
        </Button>
        {section === "board" ? (
          <Button asChild variant="secondary">
            <Link href={`/w/${slug}/meetings`}>Open meetings</Link>
          </Button>
        ) : section === "vendors" ? (
          <Button asChild variant="secondary">
            <Link href={`/w/${slug}/contacts/organisations`}>
              Open CRM organisations
            </Link>
          </Button>
        ) : null}
      </div>
      {params.new === "1" ? (
        <Card as="section" id="record-form" className="space-y-4">
          <h2 className="text-h2">Add record</h2>
          <RecordForm slug={slug} section={section} choices={choices} />
          <Link
            href={base}
            className="inline-flex min-h-11 items-center text-accent-text underline"
          >
            Cancel
          </Link>
        </Card>
      ) : null}
      {r && selected ? (
        <SelectedRecord
          key={r.id}
          actor={actor}
          data={data}
          section={section}
          choices={choices}
          selected={selected}
          base={base}
        />
      ) : null}
      {section === "board" ? (
        <details className="rounded-xl border border-line bg-panel p-4">
          <summary className="min-h-11 cursor-pointer py-3 text-title">
            AGM checklist starter
          </summary>
          <p className="mb-4 text-ink-muted">
            Add six editable items for one committee and year. Repeating this
            keeps existing items.
          </p>
          <AgmForm slug={slug} choices={choices} />
        </details>
      ) : null}
      <form
        className="grid gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2 lg:grid-cols-4"
        action={base}
      >
        <Field label="Search names">
          <Input name="q" defaultValue={filters.q} maxLength={200} />
        </Field>
        <Field label="Record type">
          <Dropdown name="kind" defaultValue={filters.kind ?? ""}>
            <option value="">All types</option>
            {SECTIONS[section].map((k) => (
              <option key={k} value={k}>
                {LABELS[k]}
              </option>
            ))}
          </Dropdown>
        </Field>
        <Field label="Status">
          <Dropdown name="status" defaultValue={filters.status ?? ""}>
            <option value="">All statuses</option>
            {statusChoices.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Dropdown>
        </Field>
        <Field label="Owner">
          <Dropdown name="owner" defaultValue={filters.owner ?? ""}>
            <option value="">All admins</option>
            {choices.owners.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Dropdown>
        </Field>
        {["compliance", "reviews", "risk", "registers"].includes(section) ? (
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              name="overdue"
              value="1"
              defaultChecked={filters.overdue === "1"}
              className="size-5"
            />
            Overdue for review / due date
          </label>
        ) : null}
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={filters.archived === "1"}
            className="size-5"
          />
          Archived records only
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
          <Link
            className="inline-flex min-h-11 items-center px-3 text-accent-text underline"
            href={base}
          >
            Clear
          </Link>
        </div>
      </form>
      <RecordList actor={actor} data={data} choices={choices} base={base} />
      <nav aria-label="Record pages" className="flex gap-4">
        {data.page > 1 ? (
          <Link
            className="min-h-11 py-3 text-accent-text underline"
            href={pageHref(data.page - 1)}
          >
            Previous
          </Link>
        ) : null}
        {data.page * 30 < data.total ? (
          <Link
            className="min-h-11 py-3 text-accent-text underline"
            href={pageHref(data.page + 1)}
          >
            Next
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
