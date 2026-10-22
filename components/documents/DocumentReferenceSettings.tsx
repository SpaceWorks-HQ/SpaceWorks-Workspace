import { TYPES, label } from "@/lib/documents/rules";
import { DocumentForm } from "@/components/documents/DocumentForm";
import { dates, object, text } from "./settings-fields";

export function DocumentReferenceSettings({
  workspaceSlug,
  references,
  assetOptions,
  currency,
}: {
  workspaceSlug: string;
  references: Array<{
    id: string;
    kind: string;
    name: string;
    data: unknown;
  }>;
  assetOptions: Array<{ id: string; name: string }>;
  currency: string;
}) {
  return (
    <>
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
            currency: currency,
          }}
          label="Add item and rate"
          fields={[
            text("name", "Item name"),
            text("description", "Description"),
            text("hsn", "HSN / SAC"),
            text("unit", "Unit / UQC"),
            {
              name: "unitMinor",
              label: `Default price (${currency})`,
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
    </>
  );
}
