"use client";

import { useCallback } from "react";
import { useToast } from "@/components/feedback/ToastProvider";
import type { ActionResult } from "@/lib/actionResult";

export type RunAction = <T>(fn: () => Promise<ActionResult<T>>, success?: string | ((data: T | undefined) => string | null)) => Promise<boolean>;

/**
 * Run a task action: toast its error, or an optional success line, then
 * call `after` (usually a refetch). Returns whether it worked.
 */
export function useTaskRunner(after: () => void | Promise<void>): RunAction {
  const { showToast } = useToast();
  return useCallback<RunAction>(
    async (fn, success) => {
      let result: ActionResult<unknown>;
      try {
        result = await fn();
      } catch {
        showToast("Couldn't save. Check your connection and try again.", "error");
        return false;
      }
      if (!result.ok) {
        showToast(result.error, "error");
        return false;
      }
      const data = (result as { data?: unknown }).data as never;
      const warning = (data as { warning?: string } | undefined)?.warning;
      const message = warning ?? (typeof success === "function" ? success(data) : success);
      if (message) showToast(message, warning ? "warning" : "success");
      await after();
      return true;
    },
    [after, showToast],
  );
}
