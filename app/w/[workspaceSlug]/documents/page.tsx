import Link from "next/link";
import { requireWorkspace } from "@/lib/permissions";
import { listDocuments } from "@/lib/documents/queries";
import { label, TYPES, INVOICES, RECEIPTS } from "@/lib/documents/rules";
import { formatMoney } from "@/lib/format/money";
import { formatDay } from "@/lib/finance/dates";
import { PageHeader, EmptyState, Chip } from "@/components/ui/display";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
export const metadata = { title: "Documents" };
export default async function Page({
  params,
  searchParams,
}: PageProps<"/w/[workspaceSlug]/documents">) {
  const { workspaceSlug } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN");
  const raw = await searchParams;
  const query = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  );
  const result = await listDocuments(actor, query);
  const base = `/w/${workspaceSlug}/documents`;
  return (
    <div className="space-y-5">
      <PageHeader
        title="Documents"
        description="Invoices, receipts, certificates and letters. Enter once, review and retain the issued copy."
        actions={
          <Link
            href={`${base}/new`}
            className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-semibold text-on-primary"
          >
            Create document
          </Link>
        }
      />
      <form className="grid gap-3 sm:grid-cols-4">
        <Field label="Search">
          <Input name="q" defaultValue={query.q} maxLength={200} />
        </Field>
        <Field label="Status">
          <Dropdown name="status" defaultValue={query.status ?? ""}>
            <option value="">All statuses</option>
            {["DRAFT", "RESERVED", "ISSUED", "CANCELLED"].map((s) => (
              <option key={s} value={s}>
                {s === "RESERVED" ? "Awaiting IRP evidence" : label(s)}
              </option>
            ))}
          </Dropdown>
        </Field>
        <Field label="Document type">
          <Dropdown name="type" defaultValue={query.type ?? ""}>
            <option value="">All types</option>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </Dropdown>
        </Field>
        <Button variant="secondary" type="submit" className="self-end">
          Filter documents
        </Button>
      </form>
      {result.rows.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
          {result.rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`${base}/${r.id}`}
                className="flex min-h-20 min-w-0 flex-wrap items-center justify-between gap-3 p-4 hover:bg-subtle"
              >
                <div className="min-w-0">
                  <p className="break-words font-semibold">
                    {r.number ?? "Draft"} · {r.title}
                  </p>
                  <p className="text-caption text-ink-muted">
                    {label(r.type)} · {formatDay(r.issuedOn)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span>{formatMoney(r.totalMinor, r.currency)}</span>
                  <Chip
                    tone={
                      r.status === "CANCELLED"
                        ? "danger"
                        : r.status === "ISSUED"
                          ? "success"
                          : "neutral"
                    }
                  >
                    {label(r.status)}
                  </Chip>
                  {RECEIPTS.includes(r.type) && r.status === "ISSUED" ? (
                    <span className="text-caption">
                      {r.paymentStatus.includes("refund")
                        ? r.paymentStatus
                        : "Received"}
                    </span>
                  ) : null}
                  {INVOICES.includes(r.type) && r.status === "ISSUED" ? (
                    <span className="text-caption">
                      {r.balance === 0
                        ? "Settled"
                        : `${formatMoney(r.balance, r.currency)} due`}
                      {r.age ? ` · ${r.age} days` : ""}
                    </span>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          patch
          title="No documents yet."
          action={
            <Link href={`${base}/new`} className="text-accent-text underline">
              Create the first document
            </Link>
          }
        />
      )}
      <div className="flex gap-4">
        {result.page > 1 ? (
          <Link
            className="min-h-11 py-3 underline"
            href={`${base}?${new URLSearchParams({ ...query, page: String(result.page - 1) })}`}
          >
            Previous
          </Link>
        ) : null}
        {result.more ? (
          <Link
            className="min-h-11 py-3 underline"
            href={`${base}?${new URLSearchParams({ ...query, page: String(result.page + 1) })}`}
          >
            Next
          </Link>
        ) : null}
      </div>
      <details className="rounded-xl border border-line bg-panel p-4">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          CSV and JSON exports
        </summary>
        <p className="mb-4 text-caption text-ink-muted">
          Preparation files for your CA. Review against the current portal
          format before manual filing.
        </p>
        <form className="grid gap-3 sm:grid-cols-3">
          <Field label="From">
            <Input
              name="start"
              type="date"
              defaultValue={
                query.start ?? `${new Date().getUTCFullYear()}-04-01`
              }
            />
          </Field>
          <Field label="To">
            <Input
              name="end"
              type="date"
              defaultValue={query.end ?? new Date().toISOString().slice(0, 10)}
            />
          </Field>
          <Button type="submit" variant="secondary">
            Set export period
          </Button>
        </form>
        <div className="mt-4 flex flex-wrap gap-4">
          {[
            "register",
            "json",
            "gst",
            "hsn",
            "tax",
            "donations",
            "series",
            "filings",
            "bundle",
          ].map((kind) => (
            <a
              key={kind}
              className="min-h-11 py-2 text-accent-text underline"
              href={`${base}/export/${kind}?${new URLSearchParams({ start: query.start ?? `${new Date().getUTCFullYear()}-04-01`, end: query.end ?? new Date().toISOString().slice(0, 10) })}`}
            >
              {kind === "gst" ? "GSTR-1 preparation" : label(kind)}
            </a>
          ))}
        </div>
      </details>
    </div>
  );
}
