import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** Geometry only: pages pass data, permissions, navigation and state as slots. */
type PageSlots = { header?: ReactNode; children: ReactNode; className?: string };
export function ListLayout({ header, toolbar, children, className }: PageSlots & { toolbar?: ReactNode }) {
  return <div data-page-layout="list" className={cn("min-w-0 space-y-6 [overflow-wrap:anywhere]", className)}>{header}{toolbar}{children}</div>;
}
export function DashboardLayout({ header, stats, actions, rail, children }: PageSlots & { stats?: ReactNode; actions?: ReactNode; rail?: ReactNode }) {
  return <div data-page-layout="dashboard" className="min-w-0 space-y-6 [overflow-wrap:anywhere]">{header}{stats}{actions}<div className={cn("grid min-w-0 gap-7", rail && "lg:grid-cols-[minmax(0,1fr)_260px]")}><div className="min-w-0 space-y-5">{children}</div>{rail ? <aside aria-label="Recent activity" className="min-w-0">{rail}</aside> : null}</div></div>;
}
export function DetailLayout({ header, back, tabs, aside, children, className }: PageSlots & { back?: { href: string; label: string }; tabs?: ReactNode; aside?: ReactNode }) {
  return <div data-page-layout="detail" className={cn("min-w-0 space-y-6 [overflow-wrap:anywhere]", className)}>{back ? <Link href={back.href} className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text hover:underline">← {back.label}</Link> : null}{header}{tabs}<div className={cn("grid min-w-0 gap-6", aside && "lg:grid-cols-[minmax(0,1fr)_280px]")}><div className="min-w-0">{children}</div>{aside ? <aside className="min-w-0">{aside}</aside> : null}</div></div>;
}
export function SettingsLayout({ header, tabs, children }: PageSlots & { tabs?: ReactNode }) {
  return <div data-page-layout="settings" className="min-w-0 space-y-6 [overflow-wrap:anywhere]">{header}{tabs}<div className="min-w-0">{children}</div></div>;
}
export function FormPageLayout({ header, preview, children, className }: PageSlots & { preview?: ReactNode }) {
  return <div data-page-layout="form" className={cn("mx-auto w-full min-w-0 max-w-5xl space-y-6 [overflow-wrap:anywhere]", className)}>{header}<div className={cn("grid min-w-0 gap-8", preview && "lg:grid-cols-[minmax(0,1fr)_300px]")}><div className="min-w-0">{children}</div>{preview ? <aside className="min-w-0">{preview}</aside> : null}</div></div>;
}
