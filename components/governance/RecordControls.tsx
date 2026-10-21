"use client";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import type { FieldSpec } from "@/lib/governance/fields";

export function Controls({
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
