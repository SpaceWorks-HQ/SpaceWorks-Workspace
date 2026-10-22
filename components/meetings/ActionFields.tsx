"use client";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import type { FormField } from "./ActionForm";

export function ActionFields({
  fields,
  fieldErrors,
  formId,
}: {
  fields: FormField[];
  fieldErrors: Record<string, string[]>;
  formId: string;
}) {
  return (
    <>
      {fields.map((field) => {
        const options = field.options ?? [];
        const errorText = fieldErrors[field.name]?.join(" ");
        if (field.type === "multi" || field.type === "single")
          return (
            <fieldset
              key={field.name}
              aria-describedby={`${formId}-${field.name}-help`}
              className="space-y-1"
            >
              <legend className="text-label">{field.label}</legend>
              {field.help ? (
                <p
                  id={`${formId}-${field.name}-help`}
                  className="text-caption text-ink-muted"
                >
                  {field.help}
                </p>
              ) : null}
              {options.map((option) => (
                <label
                  key={option.value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 hover:bg-subtle"
                >
                  <input
                    type={field.type === "multi" ? "checkbox" : "radio"}
                    name={field.name}
                    value={option.value}
                    className="size-5 accent-[var(--yy-primary)]"
                    required={field.type === "single" && field.required}
                  />
                  {option.label}
                </label>
              ))}
              {errorText ? (
                <p className="text-danger-fg text-caption">{errorText}</p>
              ) : null}
            </fieldset>
          );
        if (field.type === "ranked")
          return (
            <fieldset key={field.name} className="space-y-3">
              <legend className="text-label">{field.label}</legend>
              <p className="text-caption text-ink-muted">
                Choose your first choice, then the next. You can leave later
                ranks empty. Ties for elimination use the displayed option
                order.
              </p>
              {options.map((_, i) => (
                <Field key={i} label={`Rank ${i + 1}`}>
                  <Dropdown name={`${field.name}.${i}`} defaultValue="">
                    <option value="">No choice</option>
                    {options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Dropdown>
                </Field>
              ))}
            </fieldset>
          );
        if (field.type === "checkbox")
          return (
            <label
              key={field.name}
              className="flex min-h-11 items-center gap-3"
            >
              <input
                name={field.name}
                type="checkbox"
                defaultChecked={field.value === true}
                className="size-5 accent-[var(--yy-primary)]"
                required={field.required}
              />
              {field.label}
            </label>
          );
        return (
          <Field
            key={field.name}
            label={field.label}
            required={field.required}
            optional={!field.required}
            helperText={field.help}
            error={errorText}
          >
            {field.type === "select" ? (
              <Dropdown
                name={field.name}
                defaultValue={String(field.value ?? options[0]?.value ?? "")}
                required={field.required}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Dropdown>
            ) : ["textarea", "lines"].includes(field.type ?? "") ? (
              <Textarea
                name={field.name}
                defaultValue={String(field.value ?? "")}
                required={field.required}
                maxLength={50_000}
              />
            ) : (
              <Input
                name={field.name}
                type={field.type === "tags" ? "text" : (field.type ?? "text")}
                defaultValue={String(field.value ?? "")}
                required={field.required}
                min={field.min}
                max={field.max}
                maxLength={
                  field.type === "text" || !field.type ? 500 : undefined
                }
                step={field.type === "number" ? "any" : undefined}
              />
            )}
          </Field>
        );
      })}
    </>
  );
}
