import { ListLayout } from "@/components/ui/layouts";
import { OpsNav } from "./OpsNav";
import type { ReactNode } from "react";
import { PageHeader, Card, EmptyState } from "@/components/ui/display";
export function OpsLayout({ title, description, children, slug }: { title: string; description: string; children: ReactNode; slug: string }) {
 return <ListLayout header={<PageHeader title={title} description={description} />} toolbar={<OpsNav slug={slug} />}>{children}</ListLayout>;
}
export function Editor({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
 return <Card><details open={open}><summary className="min-h-11 cursor-pointer text-title">{title}</summary><div className="mt-4">{children}</div></details></Card>;
}
export function Empty({ children, patch = false }: { children: ReactNode; patch?: boolean }) { return <EmptyState patch={patch || undefined}>{children}</EmptyState>; }
export function words(v: string) { return v.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase()); }
export function choices(values: readonly string[]) { return values.map(value => ({ value, label: words(value) })); }
