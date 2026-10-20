import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { canViewFunding } from "@/lib/roles";
import { loadFunding } from "@/lib/funding/service";
import { object } from "@/lib/funding/analytics";
import { formatDate } from "@/lib/format/datetime";
import { PrintButton } from "@/components/funding/PrintButton";
export const metadata = { title: "Impact report" };
export default async function Page({ params }: PageProps<"/w/[workspaceSlug]/funding/impact/report">) {
  const { workspaceSlug } = await params;
  const actor = await requireWorkspace(workspaceSlug, "ADMIN");
  if (!canViewFunding(actor.membership)) notFound();
  const data = await loadFunding(actor, "impact", {});
  const programmes = data.choices.filter(r => r.kind === "PROGRAMME");
  return <article className="space-y-6 bg-panel p-6 print:p-0"><h1 className="text-h1">{actor.workspace.name} · Impact report</h1><p>Prepared {formatDate(new Date(), actor.workspace.timezone)} from manual programme records.</p><PrintButton />{!programmes.length ? <p>No programmes recorded yet.</p> : programmes.map(p => <section key={p.id} className="break-inside-avoid space-y-4 border-t border-line pt-4"><h2 className="text-h2">{p.title}</h2><p className="whitespace-pre-wrap">{String(object(p.details).purpose ?? "")}</p>{data.choices.filter(k => k.kind === "KPI" && k.parentId === p.id).map(k => { const d = object(k.details); const entries = data.choices.filter(e => e.kind === "IMPACT_ENTRY" && e.parentId === k.id).sort((a, b) => (b.dateOn?.getTime() ?? 0) - (a.dateOn?.getTime() ?? 0)); const value = d.aggregation === "LATEST" ? Number(object(entries[0]?.details).value ?? 0) : entries.reduce((sum, e) => sum + Number(object(e.details).value ?? 0), 0); return <div key={k.id} className="space-y-2"><h3 className="font-semibold">{k.title}: {value} / {Number(d.target)} {String(d.unit)}</h3>{entries.map(e => <p key={e.id}>{e.dateOn ? formatDate(e.dateOn, "UTC") : ""} · {String(object(e.details).period)} · {Number(object(e.details).value)} {String(d.unit)}</p>)}</div>; })}</section>)}</article>;
}
