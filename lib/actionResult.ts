import type { ZodError } from "zod";

/**
 * Return shape for every Server Action: `{ ok: true, data? }` or
 * `{ ok: false, error, fieldErrors? }`. Errors are short, UI-safe sentences
 * that say what happened and what to do.
 */
export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

export function actionError(error: string, fieldErrors?: Record<string, string[]>): { ok: false; error: string; fieldErrors?: Record<string, string[]> } {
  return fieldErrors ? { ok: false, error, fieldErrors } : { ok: false, error };
}

export function flattenZodErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join(".") || "_root";
    (out[path] ??= []).push(issue.message);
  }
  return out;
}

export function validationError(error: ZodError) {
  return actionError(error.issues[0]?.message ?? "Check the highlighted fields.", flattenZodErrors(error));
}

export const RATE_LIMITED = "Too many attempts. Wait a minute and try again.";
export const NOT_ALLOWED = "You don't have access to do that.";
export const SAVE_FAILED = "Couldn't save. Try again.";
