import { RecurringForm } from "@/components/finance/recurring/Forms";
import {
  ConflictLinks,
  FreezePack,
} from "@/components/govextras/ConflictLinks";
import { riskScore } from "@/lib/govextras/rules";
import Link from "next/link";
import type { GovernanceData, Actor, Filters } from "@/lib/governance/service";
import {
  LABELS,
  STATUSES,
  SECTIONS,
  label,
  sectionPath,
  dayInZone,
  type Section,
} from "@/lib/governance/schemas";
import { type Choices, recordFields } from "@/lib/governance/fields";
import {
  RecordForm,
  OperationButton,
  AgmForm,
  BankForm,
  type EditRecord,
} from "./Forms";
import { Attachments } from "./Attachments";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Card, Chip, EmptyState, Callout } from "@/components/ui/display";
import { formatDate, formatDayTime } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/money";
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
        <Card key={r.id} as="section" id="record-form" className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2 className="min-w-0 break-words text-h2">
              {r.number ? `Resolution ${r.number} · ` : ""}
              {r.title}
            </h2>
            <Button asChild variant="quiet">
              <Link href={base}>Close record</Link>
            </Button>
          </div>
          <Chip>{label(r.status)}</Chip>
          {r.meetingId ? (
            <Link
              href={`/w/${slug}/meetings/${r.meetingId}`}
              className="block min-h-11 py-3 text-accent-text underline"
            >
              Open linked meeting
            </Link>
          ) : null}
          {r.organisationId ? (
            <Link
              href={`/w/${slug}/contacts/organisations/${r.organisationId}`}
              className="block min-h-11 py-3 text-accent-text underline"
            >
              Open CRM organisation
            </Link>
          ) : null}
          {r.parentId ? (
            <Link
              href={`${base}?edit=${r.parentId}`}
              className="block min-h-11 py-3 text-accent-text underline"
            >
              Open board or committee
            </Link>
          ) : null}
          {r.kind === "CONTRACT" && details?.vendorId ? (
            <Link
              href={`${base}?edit=${String(details.vendorId)}`}
              className="block min-h-11 py-3 text-accent-text underline"
            >
              Open vendor
            </Link>
          ) : null}
          {r.approvedAt || r.archivedAt ? (
            <div className="space-y-3">
              <p className="text-ink-muted">
                {r.approvedAt ? (
                  <>
                    {r.kind === "BOARD_PACK" ? "Frozen" : "Approved"}{" "}
                    {formatDayTime(r.approvedAt, actor.workspace.timezone)} by{" "}
                    {choices.owners.find((o) => o.value === r.approvedById)
                      ?.label ?? "Former member"}
                    . Add a new record for a correction.
                  </>
                ) : (
                  <>
                    Archived{" "}
                    {formatDayTime(r.archivedAt!, actor.workspace.timezone)}.
                    Restore this record to edit it.
                  </>
                )}
              </p>
              <dl className="space-y-3">
                {recordFields(r.kind, choices)
                  .filter((f) => !["status", "title"].includes(f.name))
                  .map((f) => {
                    const value = f.name.startsWith("details.")
                      ? details?.[f.name.slice(8)]
                      : selected[f.name as keyof EditRecord];
                    return value ? (
                      <div key={f.name}>
                        <dt className="text-label">{f.label}</dt>
                        <dd className="whitespace-pre-wrap break-words">
                          {f.options?.find((o) => o.value === value)?.label ??
                            String(value)}
                        </dd>
                      </div>
                    ) : null;
                  })}
              </dl>
            </div>
          ) : (
            <RecordForm
              key={`${r.id}:${r.updatedAt.toISOString()}`}
              slug={slug}
              section={section}
              choices={choices}
              record={selected}
            />
          )}
          {typeof details?.docId === "string" ? (
            <Link
              className="inline-flex min-h-11 items-center text-accent-text underline"
              href={`/w/${slug}/docs/${details.docId}`}
            >
              Open document
            </Link>
          ) : null}
          {typeof details?.obligationId === "string" && details.obligationId ? (
            <Link
              className="inline-flex min-h-11 items-center text-accent-text underline"
              href={`/w/${slug}/governance?edit=${details.obligationId}`}
            >
              Open compliance calendar item
            </Link>
          ) : null}
          {r.kind === "INSURANCE" && !r.archivedAt ? <RecurringForm slug={slug} operation="source" fields={[{name:"source",label:"Source",type:"hidden",value:"INSURANCE"},{name:"sourceId",label:"Source id",type:"hidden",value:r.id}]} button="Create premium schedule"/> : null}
          {r.kind === "CONFLICT" && !r.archivedAt ? (
            <ConflictLinks slug={slug} id={r.id} data={data.conflict} />
          ) : null}
          {r.kind === "BOARD_PACK" && !r.approvedAt && !r.archivedAt ? (
            <FreezePack slug={slug} id={r.id} />
          ) : null}
          <Attachments
            slug={slug}
            recordId={r.id}
            locked={Boolean(r.approvedAt || r.archivedAt)}
            files={r.attachments.map((a) => a.file)}
          />
          <div className="flex flex-wrap gap-3">
            {r.archivedAt ? (
              <OperationButton slug={slug} input={{ op: "restore", id: r.id }}>
                Restore record
              </OperationButton>
            ) : null}
            {r.kind === "MINUTES" && !r.approvedAt && !r.archivedAt ? (
              <OperationButton
                slug={slug}
                input={{ op: "approve", id: r.id }}
                confirm="Approve the saved minutes and lock their text and attachments? Save any form changes first."
              >
                Approve minutes
              </OperationButton>
            ) : null}
            {r.kind === "OBLIGATION" &&
            !r.archivedAt &&
            ["FILED", "DONE"].includes(r.status) &&
            details?.recurrence !== "NONE" ? (
              <OperationButton slug={slug} input={{ op: "next", id: r.id }}>
                Add next occurrence
              </OperationButton>
            ) : null}
            {!r.approvedAt && !r.archivedAt ? (
              <OperationButton
                slug={slug}
                input={{ op: "archive", id: r.id }}
                confirm="Archive this record? It will leave the active list; proof remains private."
              >
                Archive record
              </OperationButton>
            ) : null}
          </div>
          {r.kind === "VENDOR" ? (
            <>
              {!r.archivedAt ? <BankForm slug={slug} vendorId={r.id} /> : null}
              <h3 className="text-title">Bank change log</h3>
              {!r.bankChanges.length ? (
                <p>No changes recorded.</p>
              ) : (
                <ul className="space-y-3">
                  {r.bankChanges.map((c) => (
                    <li key={c.id} className="break-words">
                      <p>
                        {formatDayTime(c.createdAt, actor.workspace.timezone)} ·{" "}
                        {choices.owners.find((o) => o.value === c.actorId)
                          ?.label ?? "Former member"}
                      </p>
                      <p>{c.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
        </Card>
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
      {!data.records.length ? (
        <EmptyState
          patch
          title="No records here yet."
          action={
            <Button asChild>
              <Link href={`${base}?new=1#record-form`}>Add record</Link>
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-caption text-ink-muted">
            {data.total} records · Page {data.page}
          </p>
          <ul className="space-y-3">
            {data.records.map((row) => {
              const overdue =
                !["DONE", "REVIEWED", "CLOSED", "FROZEN"].includes(
                  row.status,
                ) &&
                row.dueOn &&
                row.dueOn.toISOString().slice(0, 10) <
                  dayInZone(new Date(), actor.workspace.timezone);
              const d = row.details as Record<string, unknown>;
              return (
                <li key={row.id}>
                  <Link
                    href={`${base}?edit=${row.id}${row.archivedAt ? "&archived=1" : ""}`}
                    className="block space-y-2 rounded-xl border border-line bg-panel p-4 hover:border-accent focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="min-w-0 break-words text-title">
                        {row.number ? `#${row.number} · ` : ""}
                        {row.title}
                      </h2>
                      <Chip
                        tone={
                          overdue
                            ? "danger"
                            : row.status === "APPROVED" || row.status === "DONE"
                              ? "success"
                              : "neutral"
                        }
                      >
                        {row.archivedAt
                          ? "Archived"
                          : overdue
                            ? "Overdue"
                            : label(row.status)}
                      </Chip>
                    </div>
                    <p className="text-caption text-ink-muted">
                      {LABELS[row.kind]} ·{" "}
                      {choices.owners.find((o) => o.value === row.ownerId)
                        ?.label ?? "Unassigned"}
                      {row.parentId
                        ? ` · ${choices.committees.find((c) => c.value === row.parentId)?.label ?? "Committee"}`
                        : ""}
                    </p>
                    {row.dueOn ? (
                      <p>
                        {" "}
                        {row.kind === "CONFLICT" ? "Declared" : "Due"}{" "}
                        {formatDate(row.dueOn, "UTC")}
                      </p>
                    ) : null}
                    {row.startsOn ? (
                      <p>
                        {formatDate(row.startsOn, "UTC")} –{" "}
                        {formatDate(row.endsOn!, "UTC")}
                      </p>
                    ) : null}
                    {row.kind === "RISK" ? (
                      <p>
                        {
                          riskScore(Number(d.likelihood), Number(d.impact))
                            .level
                        }{" "}
                        risk · Score {Number(d.likelihood) * Number(d.impact)} /
                        25 · Likelihood {String(d.likelihood)} × impact{" "}
                        {String(d.impact)}
                      </p>
                    ) : null}
                    {row.kind === "CONTRACT" ? (
                      <p>
                        {formatMoney(Number(d.amountMinor), String(d.currency))}{" "}
                        · {String(d.noticeDays)} days’ notice
                      </p>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
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
