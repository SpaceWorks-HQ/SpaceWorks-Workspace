"use client";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { financeToolAction } from "@/app/actions/finance-tools";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { CheckboxField } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import type { ToolOperation } from "@/lib/finance/tools-rules";

export type FormField = {
  name: string;
  label: string;
  type?:
    | "text"
    | "date"
    | "month"
    | "money"
    | "select"
    | "textarea"
    | "checkbox"
    | "hidden"
    | "url";
  value?: string | boolean;
  required?: boolean;
  options?: Array<{ id: string; name: string }>;
  helper?: string;
  maxLength?: number;
  min?: string;
  max?: string;
};
export function ToolFields({
  fields,
  errors = {},
}: {
  fields: FormField[];
  errors?: Record<string, string[]>;
}) {
  return (
    <>
      {fields.map((f) => {
        if (f.type === "hidden")
          return (
            <input
              key={f.name}
              type="hidden"
              name={f.name}
              value={String(f.value ?? "")}
            />
          );
        if (f.type === "checkbox")
          return (
            <div key={f.name} className="flex min-h-11 items-center">
              <CheckboxField
                name={f.name}
                label={f.label}
                defaultChecked={f.value === true}
                description={f.helper}
              />
              {errors[f.name] ? (
                <p className="text-danger-fg">{errors[f.name]?.[0]}</p>
              ) : null}
            </div>
          );
        return (
          <Field
            key={f.name}
            label={f.label}
            optional={!f.required}
            error={errors[f.name]?.[0]}
            helperText={f.helper}
            className={f.type === "textarea" ? "sm:col-span-2" : undefined}
          >
            {f.type === "select" ? (
              <Dropdown
                name={f.name}
                defaultValue={String(f.value ?? "")}
                required={f.required}
              >
                <option value="">Choose an option</option>
                {f.options?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Dropdown>
            ) : f.type === "textarea" ? (
              <Textarea
                name={f.name}
                defaultValue={String(f.value ?? "")}
                maxLength={f.maxLength ?? 4000}
              />
            ) : (
              <Input
                name={f.name}
                type={f.type === "money" ? "text" : (f.type ?? "text")}
                inputMode={f.type === "money" ? "decimal" : undefined}
                defaultValue={String(f.value ?? "")}
                required={f.required}
                maxLength={f.maxLength ?? (f.type === "money" ? 24 : 200)}
                min={f.min}
                max={f.max}
              />
            )}
          </Field>
        );
      })}
    </>
  );
}
export function ToolForm({
  slug,
  operation,
  fields,
  button,
  children,
  onSaved,
  reset = false,
  remember = false,
  disabled = false,
}: {
  slug: string;
  operation: ToolOperation;
  fields: FormField[];
  button: string;
  children?: ReactNode;
  onSaved?: (id: string) => void;
  reset?: boolean;
  remember?: boolean;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [saved, setSaved] = useState(false);
  const [fundWarnings, setFundWarnings] = useState<string[]>([]);
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={formRef}
      aria-describedby={error ? `${id}-error` : undefined}
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || disabled) return;
        const form = new FormData(e.currentTarget);
        setError("");
        setErrors({});
        setSaved(false);
        setFundWarnings([]);
        start(async () => {
          try {
            const result = await financeToolAction(slug, operation, form);
            if (!result.ok) {
              setError(result.error);
              setErrors(result.fieldErrors ?? {});
              return;
            }
            setSaved(true);
            setFundWarnings(result.data?.warnings ?? []);
            if (remember) {
              try {
                sessionStorage.setItem(
                  `sww:finance-defaults:${slug}`,
                  JSON.stringify(
                    Object.fromEntries(
                      [
                        "kind",
                        "currency",
                        "fundId",
                        "costCentreId",
                        "categoryId",
                        "accountId",
                        "incomeSource",
                      ].map((k) => [k, form.get(k)]),
                    ),
                  ),
                );
              } catch {}
            }
            if (reset) formRef.current?.reset();
            onSaved?.(result.data!.id);
          } catch {
            setError("Couldn't save. Try again.");
          }
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <ToolFields fields={fields} errors={errors} />
      </div>
      {children}
      {error ? (
        <div id={`${id}-error`}>
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        </div>
      ) : null}
      {fundWarnings.map((warning) => (
        <Callout key={warning} tone="warning" role="status">
          {warning}
        </Callout>
      ))}
      {saved ? (
        <p role="status" className="text-body-ui text-success-fg">
          Saved.
        </p>
      ) : null}
      <div>
        <Button type="submit" loading={pending} disabled={disabled}>
          {button}
        </Button>
      </div>
    </form>
  );
}
