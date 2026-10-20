"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { linkMarketingItFile } from "@/app/actions/marketingIt";
import { Field, Dropdown } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
export function LibraryLink({ slug, recordId, files }: { slug: string; recordId: string; files: Array<{ id: string; filename: string }> }) {
 const [pending, start] = useTransition(), [message, setMessage] = useState(""), router = useRouter();
 return <form className="space-y-3" onSubmit={e => { e.preventDefault(); const id = String(new FormData(e.currentTarget).get("fileId")); start(async () => { try { const r = await linkMarketingItFile(slug, recordId, id); setMessage(r.ok ? "File linked." : r.error); router.refresh(); } catch { setMessage("Couldn't link the file. Try again."); } }); }}><Field label="Asset from the file library" required helperText="Standalone workspace files keep their existing audience."><Dropdown name="fileId" defaultValue=""><option value="">Choose a file</option>{files.map(f => <option key={f.id} value={f.id}>{f.filename}</option>)}</Dropdown></Field><Button type="submit" variant="secondary" disabled={pending}>{pending ? "Linking…" : "Link asset"}</Button><p role="status">{message}</p></form>;
}
