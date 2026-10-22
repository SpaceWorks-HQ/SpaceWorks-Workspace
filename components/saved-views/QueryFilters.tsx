"use client";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
export function QueryFilters({
  q,
  tag,
  type,
  links = false,
}: {
  q: string;
  tag?: string;
  type?: string;
  links?: boolean;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3">
      <Field
        label={links ? "Find links" : "Search workspace"}
        className="min-w-0 flex-1"
      >
        <Input
          type="search"
          name="q"
          defaultValue={q}
          maxLength={200}
          required={!links}
        />
      </Field>
      {links ? (
        <Field label="Tag">
          <Input name="tag" defaultValue={tag ?? ""} maxLength={40} />
        </Field>
      ) : null}
      {type ? <input type="hidden" name="type" value={type} /> : null}
      <Button type="submit" variant={links ? "secondary" : "primary"}>
        {links ? "Filter links" : "Search"}
      </Button>
    </form>
  );
}
