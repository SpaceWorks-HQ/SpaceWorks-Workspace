import Link from "next/link";
import { requireWorkspace } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { getSettings } from "@/lib/documents/service";
import { TYPES, label, financialYear } from "@/lib/documents/rules";
import { DocumentForm, DocumentUpload } from "@/components/documents/DocumentForm";
import { fileUrl } from "@/lib/storage";
import { PageHeader } from "@/components/ui/display";
import { object, text } from "@/components/documents/settings-fields";
import { DocumentProfileSettings } from "@/components/documents/DocumentProfileSettings";
import { DocumentReferenceSettings } from "@/components/documents/DocumentReferenceSettings";

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
      <DocumentProfileSettings
        workspaceSlug={workspaceSlug}
        profile={profile}
        assetOptions={assetOptions}
      />
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
      <DocumentReferenceSettings
        workspaceSlug={workspaceSlug}
        references={references}
        assetOptions={assetOptions}
        currency={actor.workspace.currency}
      />
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
