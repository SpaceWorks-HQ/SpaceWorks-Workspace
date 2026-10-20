import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { requireWorkspace } from "@/lib/permissions";
import { documentDetail, editorOptions } from "@/lib/documents/queries";
import { DocumentsError } from "@/lib/documents/access";
import {
  LETTERS,
  label,
  INVOICES,
  ALLOCATABLE_RECEIPTS,
} from "@/lib/documents/rules";
import type { DocumentSnapshot } from "@/lib/documents/service";
import {
  DocumentForm,
  DocumentUpload,
} from "@/components/documents/DocumentForm";
import { DocumentEditor } from "@/components/documents/DocumentEditor";
import { PageHeader, Chip, Callout } from "@/components/ui/display";
import { formatMoney } from "@/lib/format/money";
import { formatDayTime } from "@/lib/format/datetime";
import { fileUrl } from "@/lib/storage";
export default async function Page({
  params,
}: PageProps<"/w/[workspaceSlug]/documents/[documentId]">) {
  const { workspaceSlug, documentId } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN");
  let detail;
  try {
    detail = await documentDetail(actor, documentId);
  } catch (e) {
    if (e instanceof DocumentsError) notFound();
    throw e;
  }
  const { row, input, files, allocations, corrections, deliveries, history } =
      detail,
    base = `/w/${workspaceSlug}/documents`,
    snapshot =
      row.type === "PAYSLIP"
        ? null
        : (row.snapshot as unknown as DocumentSnapshot | null),
    pdf = files.find((f) => f.kind === "PDF");
  const options = await editorOptions(actor);
  return (
    <div className="space-y-5">
      <PageHeader
        kicker={row.number ?? "Draft"}
        title={row.title}
        description={`${label(row.type)} · ${formatMoney(row.totalMinor, row.currency)}`}
        actions={
          <Chip
            tone={
              row.status === "CANCELLED"
                ? "danger"
                : row.status === "ISSUED"
                  ? "success"
                  : "neutral"
            }
          >
            {label(row.status)}
          </Chip>
        }
      />
      <Link className="inline-flex min-h-11 items-center underline" href={base}>
        Back to documents
      </Link>
      {row.status === "CANCELLED" ? (
        <Callout tone="warning" title="Cancelled document">
          <p>{row.cancelReason}</p>
          <p>
            The original number and copy are retained. External filing or IRP
            cancellation must be recorded separately.
          </p>
        </Callout>
      ) : null}
      {snapshot?.source.legacyArtifact ? (
        <Callout title="Retained original receipt">
          The original stored PDF is authoritative. This entry preserves its
          existing number and proof; it does not reconstruct the historical tax
          checks.
        </Callout>
      ) : null}
      {row.status === "DRAFT" ? (
        <DocumentEditor
          slug={workspaceSlug}
          initial={{ ...input, id: row.id }}
          options={options}
        />
      ) : snapshot ? (
        <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
          <h2 className="text-h3">Frozen issue record</h2>
          <p>
            {String(snapshot.identity.name)} → {snapshot.input.partyName}
          </p>
          <p>{snapshot.input.partyAddress}</p>
          {snapshot.letter ? (
            <p className="whitespace-pre-wrap">{snapshot.letter}</p>
          ) : (
            snapshot.calculation.rows.map((l, i) => (
              <p key={i}>
                {l.description} · {l.quantity} ×{" "}
                {formatMoney(l.unitMinor, row.currency)} · Taxable{" "}
                {formatMoney(l.taxableMinor, row.currency)}
              </p>
            ))
          )}
          <p className="font-semibold">
            Total {formatMoney(snapshot.calculation.totalMinor, row.currency)}
          </p>
          <p>
            CGST {formatMoney(snapshot.calculation.cgstMinor, row.currency)} ·
            SGST/UTGST{" "}
            {formatMoney(snapshot.calculation.sgstMinor, row.currency)} · IGST{" "}
            {formatMoney(snapshot.calculation.igstMinor, row.currency)} · Cess{" "}
            {formatMoney(snapshot.calculation.cessMinor, row.currency)}
          </p>
          <p className="text-caption text-ink-muted">
            Template {snapshot.templateVersion}. Identity, wording and
            calculations are frozen.
          </p>
        </section>
      ) : null}
      {row.status === "RESERVED" ? (
        <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
          <h2 className="text-h3">Manual IRP evidence</h2>
          <p>
            The number is reserved. Submit the frozen facts manually, then
            retain the official signed evidence.
          </p>
          <DocumentForm
            slug={workspaceSlug}
            operation="evidence"
            hidden={{ id: row.id }}
            label="Save IRP reference"
            fields={[
              { name: "irn", label: "64-character IRN", required: true },
              {
                name: "acknowledgement",
                label: "Acknowledgement number",
                required: true,
              },
              {
                name: "acknowledgementAt",
                label: "Acknowledgement time",
                type: "datetime-local",
                required: true,
              },
            ]}
          />
          <h3>Official signed QR</h3>
          <DocumentUpload slug={workspaceSlug} id={row.id} kind="IRP_QR" />
          <h3>Signed JSON</h3>
          <DocumentUpload slug={workspaceSlug} id={row.id} kind="IRP_JSON" />
        </section>
      ) : null}
      {row.status === "DRAFT" || row.status === "RESERVED" ? (
        <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
          <h2 className="text-h3">Issue document</h2>
          <p>
            Issuing freezes the legal identity, calculations and wording. Review
            the saved draft first.
          </p>
          <DocumentForm
            slug={workspaceSlug}
            operation="issue"
            hidden={{ id: row.id }}
            label={
              input.irnRequired && row.status === "DRAFT"
                ? "Reserve number for IRP"
                : "Issue frozen copy"
            }
          />
        </section>
      ) : null}
      {pdf ? (
        <a
          href={fileUrl(pdf.fileId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 font-semibold text-on-primary"
        >
          Preview issued PDF
        </a>
      ) : null}
      <section className="space-y-4">
        <h2 className="text-h3">Files and proof</h2>
        {files.length ? (
          <ul className="space-y-3">
            {files.map((f) => (
              <li
                key={f.id}
                className="rounded-xl border border-line bg-panel p-4"
              >
                <p className="break-words">
                  {label(f.kind)} ·{" "}
                  <a
                    className="text-accent-text underline"
                    target="_blank"
                    rel="noreferrer"
                    href={fileUrl(f.fileId)}
                  >
                    {f.file.filename}
                  </a>
                </p>
                {f.file.contentType.startsWith("image/") ? (
                  <Image
                    unoptimized
                    width={320}
                    height={192}
                    alt={f.file.filename}
                    src={fileUrl(f.fileId)}
                    className="mt-3 max-h-48 max-w-full rounded-md object-contain"
                  />
                ) : null}
                <p className="break-all text-caption text-ink-muted">
                  SHA-256: {f.file.checksum}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p>No files yet. Add the source evidence.</p>
        )}
        <DocumentUpload slug={workspaceSlug} id={row.id} />
        <h3 className="text-title">Filing acknowledgement</h3>
        <DocumentUpload slug={workspaceSlug} id={row.id} kind="FILING_ACK" />
        {input.type === "DONATION_CERTIFICATE" ? (
          <>
            <h3>Official portal certificate</h3>
            <DocumentUpload
              slug={workspaceSlug}
              id={row.id}
              kind="OFFICIAL_CERTIFICATE"
            />
          </>
        ) : null}
      </section>
      {row.status === "ISSUED" ? (
        <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
          <h2 className="text-h3">Email the issued PDF</h2>
          <p>
            The recipient receives a copy that can be forwarded. Check the
            address before queuing.
          </p>
          <DocumentForm
            slug={workspaceSlug}
            operation="email"
            hidden={{ id: row.id }}
            fields={[
              {
                name: "recipient",
                label: "Recipient email",
                type: "email",
                required: true,
                value: input.partyEmail,
              },
            ]}
            label="Queue email with PDF"
          />
          <ul>
            {deliveries.map((d) => (
              <li key={d.id} className="break-words py-2">
                {d.recipient} · {d.status} ·{" "}
                {formatDayTime(d.createdAt, actor.workspace.timezone)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {row.status === "ISSUED" &&
      (INVOICES.includes(row.type) ||
        ALLOCATABLE_RECEIPTS.includes(row.type)) ? (
        <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
          <h2 className="text-h3">Payment allocations</h2>
          <p>
            Allocate cash and TDS separately. This does not create or duplicate
            a ledger payment.
          </p>
          <DocumentForm
            slug={workspaceSlug}
            operation="allocation"
            hidden={{
              currency: row.currency,
              key: randomUUID(),
              ...(INVOICES.includes(row.type)
                ? { invoiceId: row.id }
                : { receiptId: row.id }),
            }}
            fields={[
              {
                name: INVOICES.includes(row.type) ? "receiptId" : "invoiceId",
                label: INVOICES.includes(row.type)
                  ? "Issued receipt"
                  : "Issued invoice",
                type: "select",
                options: options.originals.filter(
                  (o) =>
                    o.status === "ISSUED" &&
                    (INVOICES.includes(row.type)
                      ? ALLOCATABLE_RECEIPTS.includes(o.type)
                      : INVOICES.includes(o.type)),
                ),
                required: true,
              },
              {
                name: "cashMinor",
                label: `Cash allocation (${row.currency})`,
                type: "money",
                value: 0,
              },
              {
                name: "tdsMinor",
                label: `TDS allocation (${row.currency})`,
                type: "money",
                value: 0,
              },
            ]}
            label="Allocate payment"
          />
          <ul>
            {allocations.map((a) => (
              <li key={a.id} className="py-2">
                {a.receipt.number} → {a.invoice.number}:{" "}
                {formatMoney(a.cashMinor, row.currency)} cash +{" "}
                {formatMoney(a.tdsMinor, row.currency)} TDS
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!LETTERS.includes(row.type) ? (
        <p className="text-caption text-ink-muted">
          Manual filing only. Have your CA review applicable fields and
          classifications.
        </p>
      ) : null}
      <section className="space-y-3">
        <h2 className="text-h3">Corrections</h2>
        {corrections.map((c) => (
          <p key={c.id}>
            <Link className="underline" href={`${base}/${c.id}`}>
              {c.number ?? c.title}
            </Link>{" "}
            · {label(c.status)}
          </p>
        ))}
        <p>
          Create a new draft and link this document as the original to retain
          correction history.
        </p>
      </section>
      {row.status === "ISSUED" || row.status === "RESERVED" ? (
        <details className="rounded-xl border border-danger-border bg-panel p-5">
          <summary className="min-h-11 cursor-pointer py-2 text-danger-fg">
            Cancel document…
          </summary>
          <p className="mb-4">
            This preserves the number and PDF. It does not reverse a bank
            payment or cancel an external filing.
          </p>
          <DocumentForm
            slug={workspaceSlug}
            operation="cancel"
            hidden={{ id: row.id }}
            fields={[
              {
                name: "reason",
                label: "Cancellation reason",
                type: "textarea",
                required: true,
              },
            ]}
            label="Confirm cancellation"
          />
        </details>
      ) : null}
      <details className="rounded-xl border border-line bg-panel p-5">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">
          Audit history
        </summary>
        <ul>
          {history.map((h) => (
            <li key={h.id} className="py-2">
              {h.action.replace("documents.", "").replaceAll("_", " ")} ·{" "}
              {formatDayTime(h.createdAt, actor.workspace.timezone)}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
