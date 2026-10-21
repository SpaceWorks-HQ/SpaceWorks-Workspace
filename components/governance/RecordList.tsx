import Link from "next/link";
import { riskScore } from "@/lib/govextras/rules";
import type { GovernanceData, Actor } from "@/lib/governance/service";
import { LABELS, label, dayInZone } from "@/lib/governance/schemas";
import type { Choices } from "@/lib/governance/fields";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState } from "@/components/ui/display";
import { formatDate } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/money";

export function RecordList({
  actor,
  data,
  choices,
  base,
}: {
  actor: Actor;
  data: GovernanceData;
  choices: Choices;
  base: string;
}) {
  return (
    <>
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
    </>
  );
}
