import Link from "next/link";
import { RecurringForm } from "@/components/finance/recurring/Forms";
import { ConflictLinks, FreezePack } from "@/components/govextras/ConflictLinks";
import type { GovernanceData, Actor } from "@/lib/governance/service";
import { label, type Section } from "@/lib/governance/schemas";
import { type Choices, recordFields } from "@/lib/governance/fields";
import { RecordForm, OperationButton, BankForm, type EditRecord } from "./Forms";
import { Attachments } from "./Attachments";
import { Button } from "@/components/ui/button";
import { Card, Chip } from "@/components/ui/display";
import { formatDayTime } from "@/lib/format/datetime";

export function SelectedRecord({
  actor,
  data,
  section,
  choices,
  selected,
  base,
}: {
  actor: Actor;
  data: GovernanceData;
  section: Section;
  choices: Choices;
  selected: EditRecord;
  base: string;
}) {
  const r = data.selected!;
  const slug = actor.workspace.slug;
  const details = r.details as Record<string, unknown>;
  return (
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
  );
}
