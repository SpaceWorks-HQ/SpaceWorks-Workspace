"use client";
import { useState, useTransition } from "react";
import { revealEmergencyAction } from "@/app/actions/people";
import type { EmergencyContact as Contact } from "@/lib/people/profiles";
import { Button } from "@/components/ui/button";
export function EmergencyContact({ slug, userId }: { slug: string; userId: string }) {
  const [contact, setContact] = useState<Contact | null | undefined>(); const [error, setError] = useState(""); const [pending, start] = useTransition();
  return <div className="flex flex-col items-start gap-3"><p className="text-caption text-ink-muted">Every view is recorded in the audit log.</p>{contact !== undefined ? <><div className="whitespace-pre-wrap text-body-ui">{contact ? [contact.name, contact.relation, contact.phone, contact.notes].filter(Boolean).join("\n") : "No emergency contact saved."}</div><Button variant="secondary" onClick={() => setContact(undefined)}>Hide contact</Button></> : <Button variant="secondary" loading={pending} onClick={() => start(async () => { try { const r = await revealEmergencyAction(slug, userId); if (r.ok) { setContact(r.data ?? null); setError(""); } else setError(r.error); } catch { setError("Couldn't load the emergency contact. Try again."); } })}>View emergency contact</Button>}{error ? <p role="alert" className="text-danger-fg">{error}</p> : null}</div>;
}
