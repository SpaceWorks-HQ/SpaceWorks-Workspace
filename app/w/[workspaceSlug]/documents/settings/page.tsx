import Link from "next/link";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/documents/service";
import { TYPES, label, financialYear } from "@/lib/documents/rules";
import {
  DocumentForm,
  DocumentUpload,
  type DocumentField,
} from "@/components/documents/DocumentForm";
import { PageHeader } from "@/components/ui/display";
import { fileUrl } from "@/lib/storage";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (name: string, title: string, value?: string): DocumentField => ({
  name,
  label: title,
  value,
});
const dates: DocumentField[] = [
  { name: "validFrom", label: "Valid from", type: "date", required: true },
  { name: "validTo", label: "Valid to", type: "date", required: true },
];
export default async function Page({
  params,
}: PageProps<"/w/[workspaceSlug]/documents/settings">) {
  const { workspaceSlug } = await params,
    actor = await requireWorkspace(workspaceSlug, "ADMIN"),
    settings = await getSettings(actor),
    { profile, references } = settings;
  const [series, assets, filingRows, preArnRows] = await Promise.all([
    prisma.documentSeries.findMany({
      where: { workspaceId: actor.workspace.id },
      orderBy: { financialYear: "desc" },
    }),
    prisma.documentFile.findMany({
      where: {
        workspaceId: actor.workspace.id,
        documentId: null,
        kind: "PROFILE",
      },
      include: { file: { select: { filename: true } } },
    }),
    prisma.documentReference.findMany({
      where: { workspaceId: actor.workspace.id, kind: "FILING_BATCH" },
      orderBy: { createdAt: "desc" },
      take: 30,
    }),
    prisma.documentReference.findMany({
      where: { workspaceId: actor.workspace.id, kind: "PRE_ARN" },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);
  const registrations = references
      .filter((r) => r.kind === "REGISTRATION")
      .map((r) => ({ id: r.id, name: r.name })),
    assetOptions = assets.map((a) => ({ id: a.fileId, name: a.file.filename }));
  return (
    <div className="space-y-5">
      <PageHeader
        title="Tax settings and templates"
        description="Keep reviewed registrations, signatories and rates here. Changes apply to future drafts."
      />
      <p>
        <Link
          className="inline-flex min-h-11 items-center text-accent-text underline"
          href={`/w/${workspaceSlug}/governance`}
        >
          Edit legal name, PAN, TAN and registered address in Governance
        </Link>
      </p>
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-h3">Organisation defaults</h2>
        <DocumentForm
          slug={workspaceSlug}
          operation="profile"
          label="Save document defaults"
          fields={[
            text(
              "country",
              "Country code (IN / GB / US / other)",
              profile.country,
            ),
            {
              name: "fiscalStartMonth",
              label: "Fiscal year start month",
              type: "number",
              value: profile.fiscalStartMonth,
            },
            {
              name: "gstScheme",
              label: "GST scheme",
              type: "select",
              value: profile.gstScheme,
              options: ["REGULAR", "COMPOSITION", "UNREGISTERED"].map((id) => ({
                id,
                name: label(id),
              })),
            },
            {
              name: "eInvoiceRequired",
              label: "E-invoicing applies to this organisation (reviewed)",
              type: "checkbox",
              value: profile.eInvoiceRequired,
            },
            text("cin", "CIN / company registration", profile.cin),
            text("contact", "Company contact particulars", profile.contact),
            text("upi", "Verified UPI ID", profile.upi),
            {
              name: "upiVerified",
              label: "Payment instructions independently verified",
              type: "checkbox",
              value: profile.upiVerified,
            },
            {
              name: "paymentInstructions",
              label: "Payment instructions",
              type: "textarea",
              value: profile.paymentInstructions,
            },
            {
              name: "logoFileId",
              label: "Organisation logo",
              type: "select",
              value: profile.logoFileId,
              options: assetOptions,
            },
            text("footer", "Document footer", profile.footer),
            {
              name: "applicability",
              label:
                "GST / turnover applicability decision and supporting advice",
              type: "textarea",
              value: profile.applicability,
            },
            {
              name: "reviewedOn",
              label: "Applicability reviewed on",
              type: "date",
              value: profile.reviewedOn,
            },
          ]}
        />
      </section>
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-h3">Logo and signature assets</h2>
        <p>
          Private images for issued copies. A signature image is not a
          cryptographic digital signature.
        </p>
        <DocumentUpload slug={workspaceSlug} kind="PROFILE" />
        {assets.map((a) => (
          <p key={a.id} className="break-all">
            <a className="text-accent-text underline" href={fileUrl(a.fileId)}>
              {a.file.filename}
            </a>{" "}
            · {a.fileId}
          </p>
        ))}
      </section>
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-h3">Tax registrations and donation approvals</h2>
        <p>
          Keep 12A/332 registration separate from 80G/354 donation approval in
          Governance. Add each issuing registration and its validity below.
        </p>
        <DocumentForm
          slug={workspaceSlug}
          operation="reference"
          hidden={{ kind: "REGISTRATION" }}
          label="Add registration"
          fields={[
            text("name", "Registration label"),
            {
              name: "kind",
              label: "Registration type",
              type: "select",
              options: ["GST", "DONATION_APPROVAL", "FCRA", "VAT"].map(
                (id) => ({ id, name: label(id) }),
              ),
            },
            text("identifier", "GSTIN / URN / approval reference"),
            text("state", "Issuing state code"),
            {
              name: "address",
              label: "Registration address",
              type: "textarea",
            },
            ...dates,
            text("section", "Deduction section (80G / 354)"),
            { name: "orderDate", label: "Approval order date", type: "date" },
            {
              name: "reviewed",
              label: "Registration and applicability reviewed",
              type: "checkbox",
            },
          ]}
        />
        {references
          .filter((r) => r.kind === "REGISTRATION")
          .map((r) => {
            const d = object(r.data);
            return (
              <details key={r.id} className="border-t border-line pt-3">
                <summary className="min-h-11 cursor-pointer py-2">
                  {r.name} · {String(d.identifier)} · {String(d.validFrom)} to{" "}
                  {String(d.validTo)}
                </summary>
                <DocumentForm
                  slug={workspaceSlug}
                  operation="reference"
                  hidden={{ ...d, id: r.id, referenceKind: "REGISTRATION" }}
                  label="Update registration"
                  fields={[
                    text("name", "Label", r.name),
                    ...dates.map((f) => ({
                      ...f,
                      value: String(d[f.name] ?? ""),
                    })),
                    {
                      name: "reviewed",
                      label: "Reviewed",
                      type: "checkbox",
                      value: d.reviewed === true,
                    },
                  ]}
                />
              </details>
            );
          })}
      </section>
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-h3">Authorised signatories</h2>
        <DocumentForm
          slug={workspaceSlug}
          operation="reference"
          hidden={{ kind: "SIGNATORY" }}
          label="Add signatory"
          fields={[
            text("name", "Signatory name"),
            text("designation", "Designation"),
            ...dates,
            {
              name: "signatureFileId",
              label: "Signature image",
              type: "select",
              options: assetOptions,
            },
          ]}
        />
        <ul>
          {references
            .filter((r) => r.kind === "SIGNATORY")
            .map((r) => (
              <li key={r.id} className="py-2">
                {r.name} · {String(object(r.data).designation)}
              </li>
            ))}
        </ul>
      </section>
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-h3">Billable items and effective-dated rates</h2>
        <p>
          Retain old items and add a dated version when rates change. Enter
          prices in your workspace currency.
        </p>
        <DocumentForm
          slug={workspaceSlug}
          operation="reference"
          hidden={{
            kind: "ITEM",
            exempt: false,
            currency: actor.workspace.currency,
          }}
          label="Add item and rate"
          fields={[
            text("name", "Item name"),
            text("description", "Description"),
            text("hsn", "HSN / SAC"),
            text("unit", "Unit / UQC"),
            {
              name: "unitMinor",
              label: `Default price (${actor.workspace.currency})`,
              type: "money",
              value: 0,
            },
            {
              name: "rateBps",
              label: "Tax rate (%)",
              type: "percent",
              value: 0,
            },
            { name: "cessBps", label: "Cess (%)", type: "percent", value: 0 },
            { name: "exempt", label: "Exempt supply", type: "checkbox" },
            text("exemption", "Exemption notification, entry and conditions"),
            ...dates,
            { name: "reviewedOn", label: "Rate reviewed on", type: "date" },
            text("source", "Source or advice reference"),
          ]}
        />
        <ul>
          {references
            .filter((r) => r.kind === "ITEM")
            .map((r) => (
              <li key={r.id} className="py-2">
                {r.name} · {Number(object(r.data).rateBps) / 100}% ·{" "}
                {String(object(r.data).hsn)}
              </li>
            ))}
        </ul>
      </section>
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-h3">Letter and certificate templates</h2>
        <p>
          Fields: person, start, end, role, programme, hours, signatory, date.
          Wrap each field in double braces, for example {"{{person}}"}.
        </p>
        <DocumentForm
          slug={workspaceSlug}
          operation="reference"
          hidden={{ kind: "TEMPLATE" }}
          label="Add template"
          fields={[
            text("name", "Template name"),
            {
              name: "type",
              label: "Document type",
              type: "select",
              options: TYPES.map((id) => ({ id, name: label(id) })),
            },
            text("version", "Version"),
            { name: "body", label: "Approved wording", type: "textarea" },
          ]}
        />
        {references
          .filter((r) => r.kind === "TEMPLATE")
          .map((r) => (
            <details key={r.id}>
              <summary className="min-h-11 cursor-pointer py-2">
                {r.name} · Version {String(object(r.data).version)}
              </summary>
              <p className="whitespace-pre-wrap">
                {String(object(r.data).body)}
              </p>
            </details>
          ))}
      </section>
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-h3">Portal-generated donation references</h2>
        <p>
          Import a real Pre-ARN before assigning it. References are never
          invented and cannot be reused.
        </p>
        <DocumentForm
          slug={workspaceSlug}
          operation="preArn"
          label="Register imported Pre-ARN"
          fields={[
            text("reference", "Portal-generated Pre-ARN"),
            text(
              "donationYear",
              "Donation year",
              financialYear(new Date().toISOString().slice(0, 10)),
            ),
            {
              name: "form",
              label: "Certificate form",
              type: "select",
              options: [
                { id: "10BE", name: "10BE — legacy periods" },
                { id: "114", name: "114 — 2026–27 onwards" },
              ],
            },
          ]}
        />
        <ul>
          {preArnRows.map((r) => (
            <li key={r.id} className="break-words py-2">
              {r.name} · {String(object(r.data).status)}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-h3">Manual filing batches</h2>
        <p>
          Freeze the preparation records and record the portal acknowledgement.
          Accepted batches retain their snapshots; corrections are filed
          separately.
        </p>
        <DocumentForm
          slug={workspaceSlug}
          operation="filing"
          label="Save filing batch"
          fields={[
            text("name", "Batch name"),
            {
              name: "correctionOf",
              label: "Correction of an accepted filing",
              type: "select",
              options: filingRows
                .filter((r) => object(r.data).status === "ACCEPTED")
                .map((r) => ({ id: r.id, name: r.name })),
            },
            {
              name: "form",
              label: "Return or statement",
              type: "select",
              options: ["GSTR1", "10BD", "113"].map((id) => ({ id, name: id })),
            },
            { name: "start", label: "Period start", type: "date" },
            { name: "end", label: "Period end", type: "date" },
            {
              name: "documentIds",
              label: "Issued document numbers (one per line)",
              type: "textarea",
            },
            {
              name: "status",
              label: "Filing status",
              type: "select",
              options: ["PREPARED", "SUBMITTED", "ACCEPTED"].map((id) => ({
                id,
                name: label(id),
              })),
            },
            text("acknowledgement", "Portal acknowledgement"),
          ]}
        />
        {filingRows.map((r) => {
          const d = object(r.data);
          return (
            <details key={r.id}>
              <summary className="min-h-11 cursor-pointer py-2">
                {r.name} · {String(d.form)} · {String(d.status)}
              </summary>
              <p className="break-all">
                Manifest SHA-256: {String(d.checksum)}
              </p>
              {d.status !== "ACCEPTED" ? (
                <DocumentForm
                  slug={workspaceSlug}
                  operation="filing"
                  hidden={{
                    ...d,
                    id: r.id,
                    documentIds: (d.documentIds as string[]).join("\n"),
                  }}
                  label="Update filing status"
                  fields={[
                    {
                      name: "status",
                      label: "Status",
                      type: "select",
                      value: String(d.status),
                      options: ["PREPARED", "SUBMITTED", "ACCEPTED"].map(
                        (id) => ({ id, name: label(id) }),
                      ),
                    },
                    text(
                      "acknowledgement",
                      "Portal acknowledgement",
                      String(d.acknowledgement),
                    ),
                  ]}
                />
              ) : (
                <p>Accepted filing retained with its original snapshots.</p>
              )}
            </details>
          );
        })}
      </section>
      <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
        <h2 className="text-h3">Financial-year number series</h2>
        <p>
          Numbers allocate atomically when issued or reserved. Issued prefixes
          and counters cannot be reset. Cancelled numbers stay in the register.
        </p>
        <DocumentForm
          slug={workspaceSlug}
          operation="series"
          label="Save number series"
          fields={[
            {
              name: "type",
              label: "Document type",
              type: "select",
              options: TYPES.map((id) => ({ id, name: label(id) })),
            },
            {
              name: "registrationId",
              label: "Issuing registration",
              type: "select",
              options: registrations,
            },
            text(
              "financialYear",
              "Financial year",
              financialYear(new Date().toISOString().slice(0, 10)),
            ),
            text("prefix", "Prefix (short and unique per registration)"),
            {
              name: "padding",
              label: "Number padding",
              type: "number",
              value: 5,
            },
            { name: "locked", label: "Lock series", type: "checkbox" },
          ]}
        />
        <ul>
          {series.map((s) => (
            <li className="py-2" key={s.id}>
              {label(s.type)} · {s.financialYear} · {s.prefix} · Next{" "}
              {s.nextNumber} · {s.locked ? "Locked" : "Open"}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
