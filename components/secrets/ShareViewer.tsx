"use client";
import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { FormPageLayout } from "@/components/ui/layouts";
import { Card, PageHeader } from "@/components/ui/display";
export function ShareViewer() {
  const fragment = useRef("");
  const revealGeneration = useRef(0);
  const [value, setValue] = useState<string | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [consumed, setConsumed] = useState(false);
  useEffect(() => {
    if (location.hash) fragment.current = location.hash.slice(1);
    history.replaceState(null, "", location.pathname);
    const hide = () => {
      if (document.hidden) {
        revealGeneration.current += 1;
        setValue(null);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      revealGeneration.current += 1;
      document.removeEventListener("visibilitychange", hide);
    };
  }, []);
  useEffect(() => {
    if (value === null) return;
    const t = setTimeout(() => setValue(null), 30000);
    return () => clearTimeout(t);
  }, [value]);
  async function view() {
    const generation = ++revealGeneration.current;
    setBusy(true);
    try {
      const [capability, key, extra] = fragment.current.split(".");
      if (extra || !capability || !key)
        throw new Error(
          "This link is incomplete. Ask the sender for the whole link.",
        );
      const decode = (s: string) =>
        Uint8Array.from(
          atob(s.replaceAll("-", "+").replaceAll("_", "/")),
          (c) => c.charCodeAt(0),
        );
      const raw = decode(key);
      if (raw.length !== 32)
        throw new Error(
          "This link is incomplete. Ask the sender for the whole link.",
        );
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        raw,
        { name: "AES-GCM" },
        false,
        ["decrypt"],
      );
      const response = await fetch("/api/secrets/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capability }),
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error("This share has expired or has already been viewed.");
      const { ciphertext } = await response.json();
      const [iv, body] = ciphertext.split(".");
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: decode(iv) },
        cryptoKey,
        decode(body),
      );
      fragment.current = "";
      setConsumed(true);
      if (generation === revealGeneration.current && !document.hidden)
        setValue(new TextDecoder().decode(plain));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't open this share.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormPageLayout className="max-w-xl" header={<PageHeader title="A private share" />}>
      <Card className="grid gap-4">
        <p>
          Open this only when you are ready. A one-time link is removed as it is
          viewed.
        </p>
        {error ? (
          <p role="alert" className="text-danger-fg">
            {error}
          </p>
        ) : null}
        {value !== null ? (
          <>
            <pre className="whitespace-pre-wrap break-all code-text">{value}</pre>
            <Button variant="secondary" onClick={() => setValue(null)}>
              Hide text
            </Button>
          </>
        ) : consumed ? (
          <p role="status">
            The text is hidden. Ask the sender for a new link if needed.
          </p>
        ) : (
          <Button variant="primary" loading={busy} disabled={busy} onClick={() => void view()}>
            {busy ? "Opening" : "View shared text"}
          </Button>
        )}
      </Card>
    </FormPageLayout>
  );
}
