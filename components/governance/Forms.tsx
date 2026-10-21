"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Dropdown } from "@/components/ui/field";
import {
  saveGovernance,
} from "@/app/actions/governance";
import {
  recordFields,
  type Choices,
} from "@/lib/governance/fields";
import {
  LABELS,
  SECTIONS,
  sectionPath,
  type Kind,
  type Section,
} from "@/lib/governance/schemas";
import { COMPLIANCE_TEMPLATES } from "@/lib/governance/templates";
import { currencyMinorDigits, parseMoneyToMinor } from "@/lib/format/money";
import type { ActionResult } from "@/lib/actionResult";
export { OperationButton } from "./OperationButton";
export { AgmForm } from "./AgmForm";
export { BankForm } from "./BankForm";
import { Controls } from "./RecordControls";

export type EditRecord = {
  id: string;
  kind: Kind;
  title: string;
  status: string;
  ownerId: string | null;
  parentId: string | null;
  organisationId: string | null;
  meetingId: string | null;
  dueOn: string;
  startsOn: string;
  endsOn: string;
  reminderDays: number;
  notes: string;
  details: Record<string, unknown>;
};

export function RecordForm({
  slug,
  section,
  choices,
  record,
}: {
  slug: string;
  section: Section;
  choices: Choices;
  record?: EditRecord;
}) {
  const [kind, setKind] = useState<Kind>(record?.kind ?? SECTIONS[section][0]);
  const [template, setTemplate] = useState("");
  const [result, setResult] = useState<ActionResult<{ id: string }> | null>(
    null,
  );
  const [pending, start] = useTransition();
  const errorRef = useRef<HTMLParagraphElement>(null);
  const router = useRouter();
  const defaults: Record<string, unknown> = record
    ? {
        ...record,
        ...Object.fromEntries(
          Object.entries(record.details).map(([k, v]) => [`details.${k}`, v]),
        ),
      }
    : {};
  if (record?.kind === "CONTRACT")
    defaults["details.amount"] = (
      Number(record.details.amountMinor) /
      10 ** currencyMinorDigits(String(record.details.currency))
    ).toFixed(currencyMinorDigits(String(record.details.currency)));
  if (record && ["INSURANCE", "LICENCE", "REGISTRATION"].includes(record.kind))
    for (const k of ["sumInsured", "premium"])
      defaults[`details.${k}`] = (
        Number(record.details[k + "Minor"]) /
        10 ** currencyMinorDigits(String(record.details.currency))
      ).toFixed(currencyMinorDigits(String(record.details.currency)));
  const picked =
    template === "" ? null : COMPLIANCE_TEMPLATES[Number(template)];
  if (!record && picked)
    Object.assign(defaults, {
      title: picked.name,
      "details.recurrence": picked.recurrence,
      "details.applicability": picked.applies,
    });
  return (
    <div className="space-y-4">
      {!record ? (
        <Field label="Record type">
          <Dropdown
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as Kind);
              setResult(null);
              setTemplate("");
            }}
          >
            {SECTIONS[section].map((k) => (
              <option key={k} value={k}>
                {LABELS[k]}
              </option>
            ))}
          </Dropdown>
        </Field>
      ) : null}
      {!record && kind === "OBLIGATION" ? (
        <Field
          label="Start from an Indian NGO template"
          helperText="Verify applicability, current forms and deadlines with your CA. No dates are assumed."
        >
          <Dropdown
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            <option value="">Custom obligation</option>
            {COMPLIANCE_TEMPLATES.map((t, i) => (
              <option key={t.name} value={i}>
                {t.name}
              </option>
            ))}
          </Dropdown>
        </Field>
      ) : null}
      <form
        key={`${record?.id ?? kind}:${template}`}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const details: Record<string, unknown> = {};
          for (const [key, value] of fd.entries())
            if (key.startsWith("details."))
              details[key.slice(8)] = [
                "details.noticeDays",
                "details.likelihood",
                "details.impact",
              ].includes(key)
                ? Number(value)
                : String(value);
          if (kind === "BOARD_PACK") {
            for (const k of ["docIds", "decisionIds", "recordIds"])
              details[k] = fd.getAll(`details.${k}`).map(String);
            details.includeFinance = fd.has("details.includeFinance");
          }
          if (["INSURANCE", "LICENCE", "REGISTRATION"].includes(kind)) {
            const currency = String(details.currency).trim().toUpperCase();
            details.currency = currency;
            for (const k of ["sumInsured", "premium"]) {
              details[k + "Minor"] = parseMoneyToMinor(
                String(details[k]),
                currency,
              );
              delete details[k];
            }
          }
          if (kind === "CONTRACT") {
            const amount = String(details.amount);
            const currency = String(details.currency).toUpperCase().trim();
            details.currency = currency;
            details.amountMinor = /^\d[\d,.\s]*$/.test(amount)
              ? parseMoneyToMinor(amount, currency)
              : null;
            delete details.amount;
          }
          const input = {
            id: record?.id ?? "",
            kind,
            title: fd.get("title"),
            status: fd.get("status"),
            ownerId: String(fd.get("ownerId") ?? ""),
            parentId: String(fd.get("parentId") ?? ""),
            organisationId: String(fd.get("organisationId") ?? ""),
            meetingId: String(fd.get("meetingId") ?? ""),
            dueOn: String(fd.get("dueOn") ?? ""),
            startsOn: String(fd.get("startsOn") ?? ""),
            endsOn: String(fd.get("endsOn") ?? ""),
            reminderDays: Number(fd.get("reminderDays") ?? 7),
            notes: fd.get("notes"),
            details,
          };
          start(async () => {
            try {
              const saved = await saveGovernance(slug, input);
              setResult(saved);
              if (saved.ok && saved.data) {
                router.push(
                  `/w/${slug}/governance${sectionPath(section)}?edit=${saved.data.id}`,
                );
                router.refresh();
              } else requestAnimationFrame(() => errorRef.current?.focus());
            } catch {
              setResult({ ok: false, error: "Couldn't save. Try again." });
            }
          });
        }}
        className="space-y-4"
      >
        <fieldset disabled={pending} className="space-y-4">
          <legend className="sr-only">
            {record ? "Edit" : "Add"} {LABELS[kind]}
          </legend>
          <Controls
            fields={recordFields(kind, choices)}
            values={defaults}
            errors={result && !result.ok ? result.fieldErrors : undefined}
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Saving" : record ? "Save changes" : "Add record"}
          </Button>
        </fieldset>
        {result && !result.ok ? (
          <p
            role="alert"
            tabIndex={-1}
            ref={errorRef}
            className="text-danger-fg"
          >
            {result.error}
          </p>
        ) : null}
        <p role="status">{result?.ok ? "Saved." : ""}</p>
      </form>
    </div>
  );
}
