"use client";

import type { DocumentDraft } from "./useDocumentDraft";
import { parseDocumentAmount, type DocumentLine } from "@/lib/documents/rules";
import { currencyMinorDigits } from "@/lib/format/money";
import { Button } from "@/components/ui/button";
import { Field, Input, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import { baseLine } from "./useDocumentDraft";

export function DocumentLineItems({ draft }: { draft: DocumentDraft }) {
  const {
    initial,
    options,
    currency,
    lines,
    setLines,
    isLetter,
    uc,
    errors,
    updateLine,
    refs,
    preview,
  } = draft;
  return (
    <>
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
    </>
  );
}
