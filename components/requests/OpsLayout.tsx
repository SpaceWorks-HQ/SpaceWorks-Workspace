import { OpsNav } from "./OpsNav";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/display";
export function OpsLayout({ title, description, children, slug }: { title: string; description: string; children: ReactNode; slug: string }) {
 return <div className="min-w-0 space-y-6 break-words"><header><h1 className="text-h1">{title}</h1><p className="mt-2 text-body-ui text-ink-muted">{description}</p></header><OpsNav slug={slug} />{children}</div>;
}
export function Editor({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
 return <Card><details open={open}><summary className="min-h-11 cursor-pointer text-title">{title}</summary><div className="mt-4">{children}</div></details></Card>;
}
export function Empty({ children }: { children: ReactNode }) { return <Card><p className="text-body-ui text-ink-muted">{children}</p></Card>; }
export function words(v: string) { return v.toLowerCase().replaceAll("_", " ").replace(/^./, c => c.toUpperCase()); }
export function choices(values: readonly string[]) { return values.map(value => ({ value, label: words(value) })); }
