"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
export function Reveal({ slug, itemId }: { slug: string; itemId: string }) {
 const [value, setValue] = useState<string | null>(null); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
 useEffect(() => { if (value === null) return; const timer = setTimeout(() => setValue(null), 30_000); const hide = () => { if (document.hidden) setValue(null); }; document.addEventListener("visibilitychange", hide); return () => { clearTimeout(timer); document.removeEventListener("visibilitychange", hide); }; }, [value]);
 async function run(action: "REVEAL" | "COPY") {
  setPending(true); setError("");
  try { const r = await fetch(`/api/w/${encodeURIComponent(slug)}/vault/items/${encodeURIComponent(itemId)}/reveal`, { method: "POST", headers: { "content-type": "application/json", "x-vault-action": "reveal" }, body: JSON.stringify({ action }), cache: "no-store" }); const data = await r.json(); if (!r.ok) { setError(data.error); return; } if (action === "COPY") { await navigator.clipboard.writeText(data.secret); setError("Copied. Clear your clipboard after use."); } else setValue(data.secret); }
  catch { setError("Couldn't access this item. Try again."); } finally { setPending(false); }
 }
 return <div className="space-y-3"><div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={pending} onClick={() => value === null ? run("REVEAL") : setValue(null)}>{value === null ? "Reveal" : "Hide"}</Button><Button variant="secondary" disabled={pending} onClick={() => run("COPY")}>Copy</Button></div>{value !== null && <pre aria-label="Revealed secret" className="max-w-full whitespace-pre-wrap break-all rounded-md border border-line bg-surface p-3 font-mono text-sm">{value}</pre>}{error && <p role="status" className="text-body-ui text-ink-muted">{error}</p>}</div>;
}
