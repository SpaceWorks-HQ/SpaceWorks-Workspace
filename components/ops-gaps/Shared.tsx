import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, Chip, EmptyState, PageHeader, Skeleton } from "@/components/ui/display";
import { label } from "@/lib/opsGaps/rules";
export function Frame({ title, description, children, back, action }: { title: string; description?: string; children: ReactNode; back?: { href: string; label: string }; action?: { href: string; label: string } }) {
  return <div className="mx-auto w-full min-w-0 max-w-5xl space-y-6 break-words [overflow-wrap:anywhere] px-4 py-6 sm:px-6">{back ? <Link href={back.href} className="inline-flex min-h-11 items-center text-primary underline underline-offset-4">← {back.label}</Link> : null}<PageHeader kicker="Operations" title={title} description={description} actions={action ? <Button asChild variant="primary"><Link href={action.href}>{action.label}</Link></Button> : undefined} />{children}</div>;
}
export function Status({ value }: { value: string }) { return <Chip tone={["CLOSED", "RESOLVED", "APPROVED", "SIGNED", "COMPLETED", "KEEP"].includes(value) ? "success" : ["URGENT", "REJECTED", "REMOVE"].includes(value) ? "danger" : ["PENDING", "WAITING", "REPORTED", "CHANGE", "OVERDUE"].includes(value) ? "warning" : "neutral"}>{label(value)}</Chip>; }
export function Empty({ line, href, action }: { line: string; href?: string; action?: string }) { return <EmptyState patch="idle" title={line} action={href && action ? <Button asChild variant="primary"><Link href={href}>{action}</Link></Button> : undefined} />; }
export function Pager({ base, page, total, size = 25, query = {} }: { base: string; page: number; total: number; size?: number; query?: Record<string, string> }) {
  const href = (n: number) => `${base}?${new URLSearchParams({ ...query, page: String(n) })}`;
  return <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-3 text-sm text-ink-secondary"><p>{total} {total === 1 ? "record" : "records"} · Page {page} of {Math.max(1, Math.ceil(total / size))}</p><div className="flex gap-2">{page > 1 ? <Button asChild><Link href={href(page - 1)}>Previous</Link></Button> : null}{page * size < total ? <Button asChild><Link href={href(page + 1)}>Next</Link></Button> : null}</div></nav>;
}
export function RecordRow({ href, title, children, status }: { href: string; title: string; children?: ReactNode; status: string }) {
  return <li className="min-w-0 border-b border-line py-4 last:border-b-0"><div className="flex flex-wrap items-start justify-between gap-3"><Link href={href} className="min-w-0 max-w-full break-words py-2 text-lg font-semibold text-primary underline-offset-4 hover:underline">{title}</Link><Status value={status} /></div><div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-secondary">{children}</div></li>;
}
export function Prose({ children }: { children: ReactNode }) { return <p className="whitespace-pre-wrap break-words text-base text-ink-secondary [overflow-wrap:anywhere]">{children}</p>; }
export function Panel({ title, children }: { title: string; children: ReactNode }) { return <Card as="section"><h2 className="mb-4 text-xl font-semibold text-ink">{title}</h2>{children}</Card>; }
export function OpsLoading() { return <div role="status" className="mx-auto max-w-5xl space-y-6 p-6"><span className="sr-only">Loading operations…</span><Skeleton className="h-10 w-2/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>; }
export const options = (values: readonly string[]) => values.map(value => ({ value, label: label(value) }));
export type ListParams = Promise<{ q?: string; status?: string; page?: string }>;
