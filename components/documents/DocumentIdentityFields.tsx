"use client";

import type { DocumentDraft } from "./useDocumentDraft";
import { TYPES, GST_TYPES, label } from "@/lib/documents/rules";
import { DocumentFields } from "./DocumentForm";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";

export function DocumentIdentityFields({ draft }: { draft: DocumentDraft }) {
  const {
    initial,
    options,
    type,
    setType,
    currency,
    setCurrency,
    sourceType,
    setSourceType,
    gstAdjustment,
    setGstAdjustment,
    gst,
    isLetter,
    errors,
    f,
    section,
    refs,
    sourceOptions,
  } = draft;
  return (
    <>
      <fieldset className="space-y-4 rounded-xl border border-line bg-panel p-4 sm:p-6">
        <legend className="px-2 text-title">Document</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Document type">
            <Dropdown
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              {TYPES.filter((t) => t !== "PAYSLIP")
                .filter((t) =>
                  options.country === "IN"
                    ? !["VAT_INVOICE", "US_ACKNOWLEDGEMENT"].includes(t)
                    : !GST_TYPES.includes(t) &&
                      !t.startsWith("DONATION_CERTIFICATE") &&
                      t !== "FCRA_RECEIPT",
                )
                .map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
            </Dropdown>
          </Field>
          <Field label="Currency">
            <Input
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </Field>
          <DocumentFields
            fields={[
              f("title", "Title"),
              f("issuedOn", "Legal issue date", "date"),
              f("dueOn", "Due date", "date"),
              {
                ...f("signatoryId", "Authorised signatory", "select"),
                options: refs("SIGNATORY"),
              },
              ...(isLetter
                ? []
                : [
                    {
                      ...f(
                        "registrationId",
                        "Issuing tax registration",
                        "select",
                      ),
                      options: refs("REGISTRATION"),
                    },
                  ]),
            ]}
            errors={errors}
          />
        </div>
      </fieldset>
      {section("Recipient", [
        {
          ...f("contactId", "CRM contact", "select"),
          options: options.contacts,
        },
        {
          ...f("organisationId", "CRM organisation", "select"),
          options: options.organisations,
        },
        f("partyName", "Recipient name"),
        f("partyEmail", "Email", "email"),
        f("partyAddress", "Billing address", "textarea"),
        f("partyTaxId", "GSTIN / VAT ID"),
        f("partyState", "Recipient state and code"),
        f("deliveryAddress", "Different delivery address", "textarea"),
      ])}
      {section("Source and corrections", [
        {
          ...f("parentId", "Original issued document", "select"),
          options: options.originals,
        },
      ])}
      <div className="grid gap-4 rounded-xl border border-line bg-panel p-4 sm:grid-cols-2">
        <Field label="Source type">
          <Dropdown
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
          >
            <option value="">Manual entry</option>
            {["INVOICE", "LEDGER", "FUND", "CONTRACT", "FUNDING"].map((t) => (
              <option key={t} value={t}>
                {label(t)}
              </option>
            ))}
          </Dropdown>
        </Field>
        {sourceType ? (
          <Field label="Existing source">
            <Dropdown name="sourceId" defaultValue={initial.sourceId}>
              <option value="">Choose an option</option>
              {sourceOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Dropdown>
          </Field>
        ) : (
          <input type="hidden" name="sourceId" value="" />
        )}
        <p className="text-caption text-ink-muted sm:col-span-2">
          Issuing a document never posts another ledger entry. Link an existing
          payment or fund where available.
        </p>
      </div>
      {["CREDIT_NOTE", "DEBIT_NOTE"].includes(type) ? (
        <div className="space-y-4">
          <CheckboxField
            label="This note changes GST"
            checked={gstAdjustment}
            onCheckedChange={(v) => setGstAdjustment(v === true)}
          />
          {!gstAdjustment ? (
            <DocumentFields
              fields={[
                f(
                  "overrideReason",
                  "Reason for a commercial adjustment without GST",
                ),
              ]}
              errors={errors}
            />
          ) : null}
        </div>
      ) : null}
      {gst || type === "VAT_INVOICE"
        ? section("Supply and tax review", [
            f("supplyOn", "Supply date / tax point", "date"),
            f("placeOfSupply", "Place of supply state code"),
            f("placeRule", "Place-of-supply rule and supporting facts"),
            {
              ...f("supplyCategory", "Supply category", "select"),
              options: [
                "DOMESTIC",
                "EXPORT_WITH_TAX",
                "EXPORT_WITHOUT_TAX",
                "SEZ_WITH_TAX",
                "SEZ_WITHOUT_TAX",
              ].map((id) => ({ id, name: label(id) })),
            },
            {
              ...f(
                "componentOverride",
                "Reviewed component override",
                "select",
              ),
              options: [
                { id: "INTRA", name: "CGST and SGST/UTGST" },
                { id: "INTER", name: "IGST" },
              ],
            },
            f("overrideReason", "Override reason"),
            f("reverseCharge", "Tax payable under reverse charge", "checkbox"),
            ...(type === "VAT_INVOICE"
              ? [
                  {
                    ...f("vatSterlingMinor", "VAT payable in GBP"),
                    value: (initial.vatSterlingMinor / 100).toFixed(2),
                  },
                ]
              : []),
          ])
        : null}
    </>
  );
}
