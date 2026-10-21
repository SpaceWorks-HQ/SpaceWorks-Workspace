import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader, Card } from "@/components/ui/display";
import { Checkbox } from "@/components/ui/choice";
export function OrgFrame({ slug, active, title, description, children }: { slug: string; active: string; title: string; description: string; children: ReactNode }) {
  return <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]"><PageHeader title={title} description={description} /><nav aria-label="Organisation tools" className="flex flex-wrap gap-x-5 border-b border-line">{[["organisation", "Organisation"], ["responsibilities", "Responsibilities"], ["attendance", "Attendance"], ["escalation", "Who do I call?"]].map(([path, label]) => <Link key={path} href={`/w/${slug}/${path}`} aria-current={active === path ? "page" : undefined} className={`inline-flex min-h-11 items-center border-b-2 text-label ${active === path ? "border-accent-text text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>{label}</Link>)}</nav>{children}</div>;
}
export function OrgPanel({ title, children, id }: { title: string; children: ReactNode; id?: string }) { return <Card as="section" id={id}><h2 className="mb-4 text-h4">{title}</h2>{children}</Card>; }
export type PersonOption = { id: string; name: string };
export const personOptions = (people: PersonOption[], optional = false) => [...(optional ? [{ value: "", label: "Not assigned" }] : []), ...people.map(p => ({ value: p.id, label: p.name }))];
export function MemberChoices({ name, label, people, chosen }: { name: string; label: string; people: PersonOption[]; chosen: string[] }) {
  return <fieldset className="min-w-0 rounded-md border border-line p-3"><legend className="px-1 text-label">{label}</legend><div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">{people.map(p => <label key={p.id} className="flex min-h-11 items-center gap-3 break-words text-body-ui"><Checkbox name={name} value={p.id} defaultChecked={chosen.includes(p.id)} />{p.name}</label>)}</div></fieldset>;
}
