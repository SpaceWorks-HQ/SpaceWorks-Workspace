"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  saveMoneyControlAction,
  transitionMoneyControlAction,
} from "@/app/actions/money-controls";
import { ToolFields, type FormField } from "@/components/finance/ToolForm";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { CheckboxField } from "@/components/ui/choice";
export function ControlForm({
  slug,
  fields,
  hidden = {},
  label = "Save record",
  transition = false,
  categories,
  selected = [],
}: {
  slug: string;
  fields: FormField[];
  hidden?: Record<string, string>;
  label?: string;
  transition?: boolean;
  categories?: { id: string; name: string }[];
  selected?: string[];
}) {
  const [operationKey, setOperationKey] = useState(() => crypto.randomUUID());
  const router = useRouter(),
    [pending, start] = useTransition(),
    [error, setError] = useState(""),
    [errors, setErrors] = useState<Record<string, string[]>>({}),
    [saved, setSaved] = useState(false);
  return (
    <form
      className="flex min-w-0 flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const form = new FormData(e.currentTarget);
        if (transition) form.set("operationKey", operationKey);
        setError("");
        setErrors({});
        setSaved(false);
        start(async () => {
          try {
            const r = await (
              transition ? transitionMoneyControlAction : saveMoneyControlAction
            )(slug, form);
            if (!r.ok) {
              setError(r.error);
              const mapped: Record<string, string[]> = {};
              for (const [k, v] of Object.entries(r.fieldErrors ?? {})) {
                let name = k
                  .replace(/^details\./, "detail.")
                  .replace(/rateBps$/, "ratePercent");
                if (
                  !fields.some((f) => f.name === name) &&
                  fields.some((f) => f.name === `detail.${name}`)
                )
                  name = `detail.${name}`;
                mapped[name] = v;
              }
              setErrors(mapped);
              return;
            }
            setSaved(true);
            setOperationKey(crypto.randomUUID());
            router.refresh();
            if (!transition)
              router.push(`${window.location.pathname}?edit=${r.data!.id}`);
          } catch {
            setError("Couldn't save the record. Try again.");
          }
        });
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <fieldset
        disabled={pending}
        className="grid min-w-0 gap-4 sm:grid-cols-2"
      >
        <legend className="sr-only">{label}</legend>
        <ToolFields fields={fields} errors={errors} />
        {categories ? (
          <fieldset className="flex flex-col gap-2 sm:col-span-2">
            <legend className="text-label">Allowed expense categories</legend>
            <p className="text-caption text-ink-muted">
              Leave all unchecked to allow every expense category.
            </p>
            {categories.map((c) => (
              <CheckboxField
                key={c.id}
                name="detail.allowedCategoryIds"
                value={c.id}
                label={c.name}
                defaultChecked={selected.includes(c.id)}
              />
            ))}
          </fieldset>
        ) : null}
      </fieldset>
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}
      {saved ? <p role="status">Record saved.</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </form>
  );
}
