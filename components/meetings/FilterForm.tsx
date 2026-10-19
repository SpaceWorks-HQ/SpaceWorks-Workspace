"use client";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

/** Keep Field and its cloned control inside the same client boundary. */
export function FilterForm({
  label,
  name,
  value,
  help,
  pattern,
  placeholder,
  button = "Filter",
}: {
  label: string;
  name: string;
  value: string;
  help?: string;
  pattern?: string;
  placeholder?: string;
  button?: string;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3">
      <Field label={label} helperText={help}>
        <Input
          name={name}
          defaultValue={value}
          pattern={pattern}
          placeholder={placeholder}
          type={name === "q" ? "search" : "text"}
          maxLength={200}
        />
      </Field>
      <Button type="submit">{button}</Button>
    </form>
  );
}
