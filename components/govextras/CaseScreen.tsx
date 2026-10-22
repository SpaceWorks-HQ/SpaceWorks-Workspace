import Link from "next/link";
import type { CaseData } from "@/lib/govextras/cases";
import { Card, Chip, EmptyState, Callout } from "@/components/ui/display";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { formatDate, formatDayTime } from "@/lib/format/datetime";
import { caseStatuses } from "@/lib/govextras/rules";
import { label } from "@/lib/governance/schemas";
import { CaseForm, CompleteAction } from "./CaseForms";
import { Attachments } from "@/components/governance/Attachments";
export function CaseScreen({
  slug,
  timezone,
  data,
  query,
}: {
  slug: string;
  timezone: string;
  data: CaseData;
  query: Record<string, string | string[] | undefined>;
}) {
  const people = data.people.map((p) => ({
      id: p.user.id,
      name: p.user.name ?? "Former member",
    })),
    handlers = people.filter((p) =>
      data.handlers.some((h) => h.userId === p.id),
    ),
    r = data.selected,
    base = `/w/${slug}/safeguarding`;
  const filterQuery = new URLSearchParams(
    Object.entries(query).filter(
      ([k, v]) => typeof v === "string" && !["edit", "new", "page"].includes(k),
    ) as [string, string][],
  );
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <header className="space-y-3">
        <Link
          className="inline-flex min-h-11 items-center text-accent-text underline"
          href={`/w/${slug}/safety`}
        >
          Safety tools
        </Link>
        <h1 className="text-h1">Safeguarding and POSH cases</h1>
        <p className="text-ink-muted">
          Confidential records for designated committee handlers. Keep personal
          details within the case.
        </p>
      </header>
      <Callout title="Designated handlers only">
        Workspace roles do not grant access to cases. Your appointment must be
        current and you must be assigned to the case. This is a manual record
        tool; the committee sets and verifies its process and dates.
      </Callout>
      {data.canAppoint ? (
        <details className="rounded-xl border border-line bg-panel p-4">
          <summary className="min-h-11 cursor-pointer py-3 text-h3">
            Committee handler appointments
          </summary>
          <CaseForm
            slug={slug}
            mode="appointment"
            people={people}
            committees={data.committees.map((c) => ({
              id: c.id,
              name: c.title,
            }))}
          />
          <ul className="space-y-3 pt-4">
            {data.appointments.map((a) => (
              <li key={a.id}>
                {people.find((p) => p.id === a.userId)?.name ?? "Former member"}{" "}
                · Until {formatDate(a.endsOn, "UTC")} ·{" "}
                {a.revokedAt ? "Revoked" : "Recorded"}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {!data.appointed ? (
        <EmptyState patch title="No current handler appointment.">
          Ask the workspace owner to record your committee appointment.
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href={`${base}?new=1#case-form`}>Record case</Link>
            </Button>
            <Button variant="secondary" asChild>
              <a href={`${base}/export?${filterQuery}`}>Export filtered CSV</a>
            </Button>
          </div>
          {query.new === "1" ? (
            <Card id="case-form" className="space-y-4">
              <h2 className="text-h2">Record a confidential case</h2>
              <CaseForm slug={slug} mode="create" people={handlers} />
            </Card>
          ) : null}
          <form
            action={base}
            className="grid gap-3 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2"
          >
            <Field label="Case number">
              <Input
                name="q"
                inputMode="numeric"
                defaultValue={typeof query.q === "string" ? query.q : ""}
              />
            </Field>
            <Field label="Status">
              <Dropdown
                name="status"
                defaultValue={
                  typeof query.status === "string" ? query.status : ""
                }
              >
                <option value="">All statuses</option>
                {caseStatuses.map((s) => (
                  <option key={s} value={s}>
                    {label(s)}
                  </option>
                ))}
              </Dropdown>
            </Field>
            <Field label="Assigned handler">
              <Dropdown
                name="owner"
                defaultValue={
                  typeof query.owner === "string" ? query.owner : ""
                }
              >
                <option value="">All handlers</option>
                {handlers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Dropdown>
            </Field>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                name="overdue"
                value="1"
                defaultChecked={query.overdue === "1"}
              />
              Overdue cases only
            </label>
            <Button variant="secondary" type="submit">
              Apply filters
            </Button>
          </form>
          {r ? (
            <Card className="space-y-5">
              <div className="flex flex-wrap justify-between gap-3">
                <h2 className="text-h2">
                  Case {r.number} · {label(r.kind)}
                </h2>
                <Link
                  className="inline-flex min-h-11 items-center text-accent-text underline"
                  href={base}
                >
                  Close case view
                </Link>
              </div>
              <Chip>{label(r.status)}</Chip>
              <p>
                Received {formatDate(r.receivedOn, "UTC")} · Review due{" "}
                {formatDate(r.dueOn, "UTC")}
              </p>
              <p className="whitespace-pre-wrap break-words">{r.details}</p>
              {!r.closedAt ? (
                <CaseForm
                  slug={slug}
                  mode="update"
                  id={r.id}
                  people={handlers}
                  defaults={{
                    status: r.status,
                    dueOn: r.dueOn.toISOString().slice(0, 10),
                    handlerIds: r.handlerIds,
                  }}
                />
              ) : null}
              <h3 className="text-h3">Case timeline</h3>
              <ol className="space-y-4">
                {r.events.map((e) => (
                  <li
                    key={e.id}
                    className="space-y-2 border-b border-line pb-4"
                  >
                    <p>
                      {label(e.kind)} · {formatDayTime(e.createdAt, timezone)} ·{" "}
                      {people.find((p) => p.id === e.actorId)?.name ??
                        "Former member"}
                    </p>
                    <p className="whitespace-pre-wrap break-words">{e.body}</p>
                    {e.dueOn ? (
                      <p>
                        Due {formatDate(e.dueOn, "UTC")} ·{" "}
                        {people.find((p) => p.id === e.ownerId)?.name ??
                          "Former handler"}{" "}
                        · {e.completedAt ? "Complete" : "Open"}
                      </p>
                    ) : null}
                    {e.kind === "ACTION" && !e.completedAt && !r.closedAt ? (
                      <CompleteAction
                        slug={slug}
                        caseId={r.id}
                        eventId={e.id}
                      />
                    ) : null}
                  </li>
                ))}
              </ol>
              {!r.closedAt ? (
                <CaseForm
                  slug={slug}
                  mode="event"
                  id={r.id}
                  people={handlers.filter((p) => r.handlerIds.includes(p.id))}
                />
              ) : (
                <p className="text-ink-muted">
                  This closed case and its evidence are locked.
                </p>
              )}
              <Attachments
                confidential
                slug={slug}
                recordId={r.id}
                locked={Boolean(r.closedAt)}
                files={r.files}
              />
            </Card>
          ) : null}
          {!data.rows.length ? (
            <EmptyState
              patch
              title="No assigned cases here yet."
              action={
                <Button asChild>
                  <Link href={`${base}?new=1`}>Record case</Link>
                </Button>
              }
            />
          ) : (
            <ul className="space-y-3">
              {data.rows.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`${base}?edit=${c.id}`}
                    className="block space-y-3 rounded-xl border border-line bg-panel p-4"
                  >
                    <h2 className="text-h3">
                      Case {c.number} · {label(c.kind)}
                    </h2>
                    <Chip>{label(c.status)}</Chip>
                    <p>Review due {formatDate(c.dueOn, "UTC")}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <nav className="flex gap-4" aria-label="Case pages">
            {data.page > 1 ? (
              <Link
                className="min-h-11 py-3 text-accent-text underline"
                href={`${base}?${filterQuery}&page=${data.page - 1}`}
              >
                Previous
              </Link>
            ) : null}
            {data.page * 30 < data.total ? (
              <Link
                className="min-h-11 py-3 text-accent-text underline"
                href={`${base}?${filterQuery}&page=${data.page + 1}`}
              >
                Next
              </Link>
            ) : null}
          </nav>
        </>
      )}
    </div>
  );
}
