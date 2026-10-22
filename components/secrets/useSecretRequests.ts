"use client";

import { secretsAction } from "@/app/actions/secrets";

type RequestContext = {
  slug: string;
  environmentId: string;
  path: string;
  revealEpoch: { current: number };
  router: { refresh: () => void };
  setError: (value: string) => void;
  setMessage: (value: string) => void;
  setBusy: (value: boolean) => void;
};

export function useSecretRequests({
  slug,
  environmentId,
  path,
  revealEpoch,
  router,
  setError,
  setMessage,
  setBusy,
}: RequestContext) {
  async function act(
    operation: string,
    input: Record<string, unknown> = {},
    refresh = true,
  ): Promise<unknown> {
    setError("");
    setMessage("");
    setBusy(true);
    const epoch = revealEpoch.current;
    try {
      const result = await secretsAction(slug, operation, {
        environmentId,
        ...input,
      });
      if (!result.ok) {
        setError(result.error);
        return undefined;
      }
      const pending =
        result.data &&
        typeof result.data === "object" &&
        "pending" in result.data &&
        result.data.pending;
      setMessage(
        pending
          ? "Change submitted for approval."
          : operation === "mfa"
            ? "Verified for five minutes."
            : "Done.",
      );
      if (refresh) router.refresh();
      if (["token", "share", "identity-credential"].includes(operation) && epoch !== revealEpoch.current) return undefined;
      return result.data ?? true;
    } catch {
      setError("Couldn't complete the action. Try again.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function valueRequest(
    input: Record<string, unknown>,
    download?: string,
  ) {
    setError("");
    setBusy(true);
    const epoch = revealEpoch.current;
    try {
      const response = await fetch(
        `/api/w/${encodeURIComponent(slug)}/secrets`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ environmentId, path, ...input }),
          cache: "no-store",
        },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error ?? "Couldn't read this key.");
      }
      if (download) {
        const blob = await response.blob(),
          url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = download;
        a.click();
        URL.revokeObjectURL(url);
        setMessage("Downloaded. Keep this file private.");
        return;
      }
      const result = await response.json();
      return epoch === revealEpoch.current && !document.hidden ? result : undefined;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read this key.");
    } finally {
      setBusy(false);
    }
  }
  return { act, valueRequest };
}
