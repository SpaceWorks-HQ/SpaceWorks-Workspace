"use client";
import { useActionState, useId } from "react";
import { useRouter } from "next/navigation";
import { recurringCostAction } from "@/app/actions/recurring-costs";
import { ToolFields, type FormField } from "@/components/finance/ToolForm";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/actionResult";
export function RecurringForm({
  slug,
  operation,
  fields,
  advanced = [],
  button,
}: {
  slug: string;
  operation: string;
  fields: FormField[];
  advanced?: FormField[];
  button: string;
}) {
  const router = useRouter(),
    id = useId();
  const [state, action, pending] = useActionState(
    async (_previous: ActionResult<string> | null, form: FormData) => {
      try {
        const result = await recurringCostAction(slug, operation, form);
        if (result.ok) {
          if (result.data?.startsWith("/w/")) router.push(result.data);
          router.refresh();
        }
        return result;
      } catch {
        return {
          ok: false as const,
          error: "Couldn't save. Check your connection and try again.",
        };
      }
    },
    null,
  );
  const errors = state && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form
      action={action}
      aria-busy={pending}
      aria-describedby={state && !state.ok ? `${id}-error` : undefined}
      className="space-y-4"
    >
      <fieldset disabled={pending} className="min-w-0 space-y-4">
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          <ToolFields fields={fields} errors={errors} />
        </div>
        {advanced.length ? (
          <details open={advanced.some((f) => errors[f.name]) || undefined}>
            <summary className="min-h-11 cursor-pointer py-3 font-semibold">
              Accounting, source links and loan details
            </summary>
            <div className="grid min-w-0 grid-cols-1 gap-4 py-3 sm:grid-cols-2">
              <ToolFields fields={advanced} errors={errors} />
            </div>
          </details>
        ) : null}
        <Button type="submit" loading={pending} loadingLabel="Saving">
          {button}
        </Button>
      </fieldset>
      {state ? (
        state.ok ? (
          <p role="status" className="text-sm text-success-fg">
            Saved.
          </p>
        ) : (
          <p id={`${id}-error`} role="alert" className="text-sm text-danger-fg">
            {state.error}
          </p>
        )
      ) : null}
    </form>
  );
}
