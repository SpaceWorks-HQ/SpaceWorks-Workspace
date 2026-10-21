"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  saveGovernance,
  governanceOperation,
  saveVendorBank,
  revealVendorBank,
} from "@/app/actions/governance";
import {
  recordFields,
  type Choices,
  type FieldSpec,
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

function Controls({
  fields,
  values,
  errors,
}: {
  fields: FieldSpec[];
  values?: Record<string, unknown>;
  errors?: Record<string, string[]>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const value = String(values?.[f.name] ?? f.value ?? "");
        return (
          <Field
            key={f.name}
            label={f.label}
            required={f.required}
            optional={!f.required}
            helperText={f.help}
            error={errors?.[f.name]?.join(" ")}
            className={f.type === "textarea" ? "sm:col-span-2" : ""}
          >
            {f.type === "multi" ? (
              <div
                role="group"
                aria-label={f.label}
                className="max-h-64 overflow-auto rounded-control border border-line p-3"
              >
                {f.options?.map((o) => (
                  <label
                    key={o.value}
                    className="flex min-h-11 items-center gap-3"
                  >
                    <input
                      type="checkbox"
                      name={f.name}
                      value={o.value}
                      defaultChecked={
                        Array.isArray(values?.[f.name]) &&
                        (values[f.name] as string[]).includes(o.value)
                      }
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            ) : f.type === "checkbox" ? (
              <input
                type="checkbox"
                name={f.name}
                defaultChecked={values?.[f.name] === true}
                className="size-5"
              />
            ) : f.type === "select" ? (
              <Dropdown
                name={f.name}
                defaultValue={value || f.options?.[0]?.value}
                required={f.required}
              >
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Dropdown>
            ) : f.type === "textarea" ? (
              <Textarea
                name={f.name}
                defaultValue={value}
                maxLength={f.name === "details.content" ? 50000 : 20000}
              />
            ) : (
              <Input
                name={f.name}
                type={f.type ?? "text"}
                defaultValue={value}
                min={f.type === "number" ? 0 : undefined}
                max={f.max}
                step={f.type === "number" ? 1 : undefined}
                maxLength={f.name === "details.year" ? 4 : 300}
              />
            )}
          </Field>
        );
      })}
    </div>
  );
}
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
export function OperationButton({
  slug,
  input,
  children,
  confirm,
}: {
  slug: string;
  input: Record<string, unknown>;
  children: string;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  function run() {
    start(async () => {
      try {
        const result = await governanceOperation(slug, input);
        if (!result.ok) setError(result.error);
        else {
          setError("");
          if (input.op === "next" && result.data)
            router.push(`?edit=${result.data.id}`);
          else if (input.op === "archive") router.push("?");
          router.refresh();
        }
      } catch {
        setError("Couldn't save. Try again.");
      }
    });
  }
  return (
    <div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => (confirm ? setOpen(true) : run())}
      >
        {pending ? "Saving" : children}
      </Button>
      {error ? (
        <p role="alert" className="text-danger-fg">
          {error}
        </p>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          open={open}
          title={children}
          message={confirm}
          confirmLabel={children}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            run();
          }}
        />
      ) : null}
    </div>
  );
}
export function AgmForm({ slug, choices }: { slug: string; choices: Choices }) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          try {
            const r = await governanceOperation(slug, {
              op: "agm",
              parentId: fd.get("parentId"),
              year: fd.get("year"),
              dueOn: fd.get("dueOn"),
            });
            setMessage(r.ok ? "Checklist ready." : r.error);
            router.refresh();
          } catch {
            setMessage("Couldn't save. Try again.");
          }
        });
      }}
    >
      <Controls
        fields={[
          {
            name: "parentId",
            label: "Board or committee",
            type: "select",
            options: choices.committees,
            required: true,
          },
          {
            name: "year",
            label: "AGM year",
            value: new Date().getFullYear(),
            required: true,
          },
          { name: "dueOn", label: "Due date", type: "date", required: true },
        ]}
      />
      <Button variant="secondary" type="submit" disabled={pending}>
        {pending ? "Adding" : "Add AGM checklist"}
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
export function BankForm({
  slug,
  vendorId,
}: {
  slug: string;
  vendorId: string;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [bank, setBank] = useState<Awaited<
    ReturnType<typeof revealVendorBank>
  > | null>(null);
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const prefix = useId();
  return (
    <section className="space-y-4" aria-labelledby={`${prefix}-bank`}>
      <h3 id={`${prefix}-bank`} className="text-title">
        Bank details
      </h3>
      <p className="text-ink-muted">
        Enter a complete replacement. Each change and reveal is logged. Banking
        values stay out of search and CSV exports.
      </p>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => {
          if (bank) {
            setBank(null);
            return;
          }
          start(async () => {
            try {
              setBank(await revealVendorBank(slug, vendorId));
            } catch {
              setMessage("Couldn't reveal bank details. Try again.");
            }
          });
        }}
      >
        {bank ? "Hide bank details" : "Reveal current bank details"}
      </Button>
      {bank?.ok ? (
        <div className="whitespace-pre-wrap break-words rounded-lg border border-line p-4">
          {bank.data
            ? Object.entries(bank.data).map(([k, v]) => (
                <p key={k}>
                  {
                    (
                      {
                        accountName: "Account holder",
                        accountNumber: "Account number",
                        bankName: "Bank",
                        routingCode: "IFSC / routing code",
                      } as Record<string, string>
                    )[k]
                  }
                  : {v}
                </p>
              ))
            : "No bank details recorded."}
        </div>
      ) : bank ? (
        <p role="alert">{bank.error}</p>
      ) : null}
      <details>
        <summary className="min-h-11 cursor-pointer py-3 text-accent-text">
          Change bank details
        </summary>
        <form
          ref={form}
          className="space-y-4"
          autoComplete="off"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            start(async () => {
              try {
                const r = await saveVendorBank(slug, {
                  ...Object.fromEntries(fd),
                  vendorId,
                });
                setMessage(r.ok ? "Bank details saved." : r.error);
                if (r.ok) {
                  setBank(null);
                  form.current?.reset();
                  router.refresh();
                }
              } catch {
                setMessage("Couldn't save. Try again.");
              }
            });
          }}
        >
          <fieldset disabled={pending} className="space-y-4">
            <legend className="sr-only">Replacement bank details</legend>
            <Controls
              fields={[
                {
                  name: "accountName",
                  label: "Account holder",
                  required: true,
                },
                { name: "bankName", label: "Bank name", required: true },
                {
                  name: "accountNumber",
                  label: "Account number / IBAN",
                  required: true,
                },
                { name: "routingCode", label: "IFSC / routing / SWIFT code" },
                {
                  name: "reason",
                  label: "Reason for change",
                  type: "textarea",
                  required: true,
                },
              ]}
            />
            <Button variant="secondary" type="submit" disabled={pending}>
              Save bank details
            </Button>
          </fieldset>
        </form>
      </details>
      <p role="status">{message}</p>
    </section>
  );
}
