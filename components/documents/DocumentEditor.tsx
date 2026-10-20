"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { documentAction } from "@/app/actions/documents";
import {
  TYPES,
  LETTERS,
  GST_TYPES,
  label,
  calculate,
  parseDocumentAmount,
  type DraftInput,
  type DocumentLine,
} from "@/lib/documents/rules";
import type { EditorOptions } from "@/lib/documents/types";
import { DocumentFields, type DocumentField } from "./DocumentForm";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import { formatMoney, currencyMinorDigits } from "@/lib/format/money";

const baseLine: DocumentLine = {
  description: "",
  quantity: "1",
  unitMinor: 0,
  discountMinor: 0,
  hsn: "",
  unit: "NOS",
  rateBps: 0,
  cessBps: 0,
  exempt: false,
  exemption: "",
  ruleId: "",
};
export function DocumentEditor({
  slug,
  initial,
  options,
}: {
  slug: string;
  initial: DraftInput;
  options: EditorOptions;
}) {
  const [type, setType] = useState(initial.type),
    [gstAdjustment, setGstAdjustment] = useState(initial.gstAdjustment),
    [currency, setCurrency] = useState(initial.currency),
    [sourceType, setSourceType] = useState(initial.sourceType),
    [lines, setLines] = useState<DocumentLine[]>(
      initial.lines.length ? initial.lines : [{ ...baseLine }],
    ),
    [message, setMessage] = useState(""),
    [errors, setErrors] = useState<Record<string, string[]>>({}),
    [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null),
    router = useRouter();
  const refs = (kind: string) =>
    options.references
      .filter((r) => r.kind === kind)
      .map((r) => ({ id: r.id, name: r.name }));
  const isLetter = LETTERS.includes(type),
    gst =
      GST_TYPES.includes(type) &&
      (!["CREDIT_NOTE", "DEBIT_NOTE"].includes(type) || gstAdjustment),
    donation = type.startsWith("DONATION"),
    uc = type.endsWith("_UC"),
    receipt =
      type === "US_ACKNOWLEDGEMENT" ||
      type.includes("RECEIPT") ||
      type === "PAYMENT_REFUND" ||
      type.includes("VOUCHER") ||
      donation;
  const f = (
    name: keyof DraftInput,
    title: string,
    kind?: DocumentField["type"],
    helper?: string,
  ): DocumentField => ({
    name,
    label: title,
    type: kind,
    value: initial[name] as string | number | boolean,
    helper,
  });
  const section = (title: string, fields: DocumentField[]) => (
    <fieldset className="space-y-4 rounded-xl border border-line bg-panel p-4 sm:p-6">
      <legend className="px-2 text-title">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <DocumentFields fields={fields} errors={errors} />
      </div>
    </fieldset>
  );
  const updateLine = (i: number, change: Partial<DocumentLine>) =>
    setLines(lines.map((l, n) => (n === i ? { ...l, ...change } : l)));
  const sourceOptions =
    sourceType === "INVOICE"
      ? options.invoices
      : sourceType === "LEDGER"
        ? options.ledger
        : sourceType === "FUND"
          ? options.funds
          : sourceType === "FUNDING"
            ? options.funding
            : sourceType === "CONTRACT"
              ? options.contracts
              : [];
  let preview = "Add lines to preview the total.";
  try {
    preview = `Preview before tax review: ${formatMoney(calculate(lines, "NONE").totalMinor, currency)}`;
  } catch {
    /* Fields may be incomplete while typing. */
  }
  return (
    <form
      ref={formRef}
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const raw: Record<string, unknown> = {
          ...initial,
          ...Object.fromEntries(form),
          type,
          currency,
          sourceType,
          lines: isLetter || uc ? [] : lines,
          gstAdjustment,
        };
        for (const key of [
          "cashMinor",
          "tdsMinor",
          "inrMinor",
          "openingMinor",
          "receiptsMinor",
          "interestMinor",
          "expenditureMinor",
          "refundsMinor",
          "advancesMinor",
          "benefitValueMinor",
          "vatSterlingMinor",
        ]) {
          const value = form.get(key);
          if (value !== null) {
            const n = parseDocumentAmount(
              String(value),
              key === "vatSterlingMinor"
                ? "GBP"
                : key === "inrMinor"
                  ? "INR"
                  : currency,
            );
            if (n === null) {
              setMessage(
                "Enter money using decimal amounts, for example 1250.50.",
              );
              return;
            }
            raw[key] = n;
          }
        }
        for (const key of [
          "reviewed",
          "roundRupee",
          "reverseCharge",
          "fcraAccount",
          "irnRequired",
        ])
          raw[key] = form.get(key) === "on";
        form.set("payload", JSON.stringify(raw));
        start(async () => {
          const r = await documentAction(slug, "draft", form);
          if (r.ok && r.data) {
            router.push(`/w/${slug}/documents/${r.data.id}`);
            router.refresh();
          } else if (!r.ok) {
            setMessage(r.error);
            setErrors(r.fieldErrors ?? {});
            errorRef.current?.focus();
          }
        });
      }}
    >
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
              <option value="">Choose…</option>
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
      {!isLetter && !uc ? (
        <fieldset className="space-y-4 rounded-xl border border-line bg-panel p-4 sm:p-6">
          <legend className="px-2 text-title">Items and services</legend>
          <p className="text-caption text-ink-muted">
            Rates and classifications are your editable data. Choose reviewed
            rates for the supply date.
          </p>
          {lines.map((line, i) => (
            <div
              key={i}
              className="grid gap-3 border-b border-line pb-5 sm:grid-cols-2"
            >
              <Field label={`Line ${i + 1} · catalogue item`}>
                <Dropdown
                  value=""
                  onChange={(e) => {
                    const item = options.references.find(
                      (r) => r.id === e.target.value,
                    );
                    if (item)
                      updateLine(i, {
                        ...(item.data as object),
                        ruleId: item.id,
                      } as Partial<DocumentLine>);
                  }}
                >
                  <option value="">Choose or enter manually</option>
                  {refs("ITEM").map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </Dropdown>
              </Field>
              <Field
                label="Description"
                error={errors[`lines.${i}.description`]?.[0]}
              >
                <Input
                  value={line.description}
                  onChange={(e) =>
                    updateLine(i, { description: e.target.value })
                  }
                  required
                  maxLength={500}
                />
              </Field>
              <Field label="Quantity">
                <Input
                  value={line.quantity}
                  inputMode="decimal"
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                />
              </Field>
              <Field label="Unit price">
                <Input
                  defaultValue={(
                    line.unitMinor /
                    10 ** currencyMinorDigits(currency)
                  ).toFixed(currencyMinorDigits(currency))}
                  key={`${i}-${line.ruleId}`}
                  inputMode="decimal"
                  onChange={(e) => {
                    const n = parseDocumentAmount(e.target.value, currency);
                    updateLine(i, { unitMinor: n ?? 0 });
                  }}
                />
              </Field>
              <Field label="Discount amount">
                <Input
                  defaultValue={(
                    line.discountMinor /
                    10 ** currencyMinorDigits(currency)
                  ).toFixed(currencyMinorDigits(currency))}
                  inputMode="decimal"
                  onChange={(e) =>
                    updateLine(i, {
                      discountMinor:
                        parseDocumentAmount(e.target.value, currency) ?? 0,
                    })
                  }
                />
              </Field>
              <Field label="HSN / SAC">
                <Input
                  value={line.hsn}
                  onChange={(e) => updateLine(i, { hsn: e.target.value })}
                />
              </Field>
              <Field label="Unit / UQC">
                <Input
                  value={line.unit}
                  onChange={(e) => updateLine(i, { unit: e.target.value })}
                />
              </Field>
              <Field label="Tax rate (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={line.rateBps / 100}
                  onChange={(e) =>
                    updateLine(i, {
                      rateBps: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </Field>
              <Field label="Cess (%)">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={line.cessBps / 100}
                  onChange={(e) =>
                    updateLine(i, {
                      cessBps: Math.round(Number(e.target.value) * 100),
                    })
                  }
                />
              </Field>
              <CheckboxField
                label="Exempt line"
                checked={line.exempt}
                onCheckedChange={(checked) =>
                  updateLine(i, { exempt: checked === true })
                }
              />
              <Field label="Exemption entry and conditions">
                <Input
                  value={line.exemption}
                  onChange={(e) => updateLine(i, { exemption: e.target.value })}
                />
              </Field>
              <Button
                variant="quiet"
                onClick={() => setLines(lines.filter((_, n) => n !== i))}
              >
                Remove line {i + 1}
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() => setLines([...lines, { ...baseLine }])}
            disabled={lines.length >= 100}
          >
            Add line
          </Button>
          <p role="status">{preview}</p>
          <CheckboxField
            name="roundRupee"
            label="Round final INR total to the nearest rupee"
            defaultChecked={initial.roundRupee}
          />
        </fieldset>
      ) : null}
      {receipt
        ? section("Payment and withholding", [
            f("paymentOn", "Payment date", "date"),
            {
              ...f("paymentMode", "Payment mode", "select"),
              options: [
                "CASH",
                "BANK",
                "UPI",
                "CHEQUE",
                "CARD",
                "OTHER",
                "IN_KIND",
              ].map((id) => ({ id, name: label(id) })),
            },
            f("paymentReference", "Bank / UPI / cheque reference"),
            {
              ...f(
                "cashMinor",
                ["PAYMENT_REFUND", "REFUND_VOUCHER"].includes(type)
                  ? "Actual cash returned"
                  : type === "PAYMENT_VOUCHER"
                    ? "Actual cash paid"
                    : "Actual cash received",
              ),
              value: (
                initial.cashMinor /
                10 ** currencyMinorDigits(currency)
              ).toFixed(currencyMinorDigits(currency)),
            },
            {
              ...f("tdsMinor", "TDS withheld by customer"),
              value: (
                initial.tdsMinor /
                10 ** currencyMinorDigits(currency)
              ).toFixed(currencyMinorDigits(currency)),
            },
            f("tdsSection", "Withholding section"),
          ])
        : null}
      {donation
        ? section("Donation certificate details", [
            {
              ...f("donorIdType", "Donor identification type", "select"),
              options: [
                "PAN",
                "PASSPORT",
                "VOTER_ID",
                "FOREIGN_TIN",
                "AADHAAR",
                "DRIVING_LICENCE",
                "RATION_CARD",
              ].map((id) => ({ id, name: label(id) })),
            },
            f("donorId", "Donor identification"),
            {
              ...f("donationCategory", "Donation category", "select"),
              options: [
                "CORPUS",
                "VOLUNTARY",
                "SPECIFIC_GRANT",
                "CSR",
                "OTHER",
              ].map((id) => ({ id, name: label(id) })),
            },
            {
              ...f("approvalId", "Donation approval", "select"),
              options: refs("REGISTRATION"),
            },
            f("deductionSection", "Deduction section (80G / 354)"),
            {
              ...f("portalReferenceType", "Imported reference type", "select"),
              options: [
                { id: "PRE_ARN", name: "Portal-generated Pre-ARN" },
                {
                  id: "CERTIFICATE_ACK",
                  name: "Official certificate acknowledgement",
                },
              ],
            },
            f("portalReference", "Imported portal acknowledgement / Pre-ARN"),
            f("portalDate", "Portal certificate date", "date"),
            f("filingReference", "Accepted filing reference"),
            f("programme", "Purpose / campaign"),
            f(
              "exchangeBasis",
              "Foreign donation conversion rate, source and date",
            ),
            {
              ...f("inrMinor", "INR reporting amount"),
              value: (initial.inrMinor / 100).toFixed(2),
            },
          ])
        : null}
      {type === "FCRA_RECEIPT"
        ? section("Foreign contribution", [
            f(
              "fcraAccount",
              "Received in the designated FCRA account",
              "checkbox",
            ),
            f("donorCountry", "Donor country"),
            f("foreignSourceBasis", "Foreign-source classification evidence"),
            f("exchangeBasis", "Conversion rate, source and date"),
            {
              ...f("inrMinor", "INR reporting amount"),
              value: (initial.inrMinor / 100).toFixed(2),
            },
          ])
        : null}
      {isLetter
        ? section("Letter and merge fields", [
            {
              ...f("personId", "Person record", "select"),
              options: options.people,
            },
            {
              ...f("templateId", "Approved template", "select"),
              options: refs("TEMPLATE"),
            },
            f("role", "Role"),
            f("programme", "Programme"),
            f("startsOn", "Engagement start", "date"),
            f("endsOn", "Engagement end", "date"),
            f("hours", "Verified hours"),
            f(
              "letterBody",
              "Letter wording",
              "textarea",
              "Merge fields: {{person}}, {{start}}, {{end}}, {{role}}, {{programme}}, {{hours}}, {{signatory}}, {{date}}. Leave blank to use the selected template.",
            ),
          ])
        : null}
      {uc
        ? section("Utilisation and schedules", [
            f("periodStart", "Period start", "date"),
            f("periodEnd", "Period end", "date"),
            f("sanction", "Sanction numbers, dates and agreement", "textarea"),
            ...[
              "openingMinor",
              "receiptsMinor",
              "interestMinor",
              "expenditureMinor",
              "refundsMinor",
              "advancesMinor",
            ].map((n) => ({
              ...f(n as keyof DraftInput, label(n.replace("Minor", ""))),
              value: (
                Number(initial[n as keyof DraftInput]) /
                10 ** currencyMinorDigits(currency)
              ).toFixed(currencyMinorDigits(currency)),
            })),
            f(
              "schedules",
              "Component-wise schedules and certifications",
              "textarea",
            ),
            f("outcomes", "Outcomes, checks and sign-off wording", "textarea"),
          ])
        : null}
      {type === "US_ACKNOWLEDGEMENT"
        ? section("US acknowledgement", [
            f(
              "benefits",
              "Goods or services supplied in return (state none if none)",
              "textarea",
            ),
            {
              ...f("benefitValueMinor", "Good-faith benefit value"),
              value: (initial.benefitValueMinor / 100).toFixed(2),
            },
          ])
        : null}
      {gst
        ? section("Manual portal evidence", [
            f(
              "irnRequired",
              "IRP evidence required before final issue",
              "checkbox",
            ),
            f("ewayReference", "E-way-bill reference"),
          ])
        : null}
      <Field label="Notes and terms">
        <Textarea name="notes" defaultValue={initial.notes} maxLength={12000} />
      </Field>
      <CheckboxField
        name="reviewed"
        label="I reviewed classification, required fields, source facts and signing authority"
        defaultChecked={initial.reviewed}
      />
      <p ref={errorRef} tabIndex={-1} role="alert" className="text-danger-fg">
        {message}
      </p>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save draft"}
      </Button>
      <p className="text-caption text-ink-muted">
        Save first, attach evidence, then review and issue the frozen copy.
      </p>
    </form>
  );
}
