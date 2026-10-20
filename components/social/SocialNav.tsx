import Link from "next/link";
import { NavTabs } from "@/components/ui/tabs";
import { Chip, PageHeader } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
export function SocialNav({ slug, active, admin }: { slug: string; active: "overview" | "comments" | "settings" | "account"; admin: boolean }) {
  return <><PageHeader title="Social" description="See how your official accounts are doing and keep up with the conversation." actions={admin && active !== "settings" ? <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${slug}/settings/social`}>Manage accounts</Link> : undefined} /><NavTabs label="Social" items={[{ label: "Overview", href: `/w/${slug}/social`, active: active === "overview" || active === "account" }, { label: "Comments", href: `/w/${slug}/social/comments`, active: active === "comments" }, ...(admin ? [{ label: "Connections", href: `/w/${slug}/settings/social`, active: active === "settings" }] : [])]} /></>;
}
export const statusLabels = { NEW: "New", SEEN: "Seen", REPLIED: "Replied", HIDDEN: "Hidden", DELETED: "Deleted" } as const;
export function CommentStatus({ status }: { status: keyof typeof statusLabels }) { return <Chip tone={status === "NEW" ? "info" : status === "REPLIED" ? "success" : "neutral"}>{statusLabels[status]}</Chip>; }
export function AccountStatus({ status }: { status: string }) { return <Chip tone={status === "ACTIVE" ? "success" : status === "RECONNECT" ? "danger" : status === "DEGRADED" ? "warning" : "neutral"}>{({ ACTIVE: "Connected", DEGRADED: "Some data unavailable", RECONNECT: "Reconnect needed", DISCONNECTED: "Disconnected", DEMO: "Demo account" } as Record<string, string>)[status] ?? status}</Chip>; }
export const metricValue = (v: number | null | undefined) => v == null ? "Unavailable" : new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 }).format(v);
export function safeSocialUrl(url: string | null | undefined) { if (!url) return undefined; try { const u = new URL(url); return u.protocol === "https:" && ["youtube.com", "www.youtube.com", "facebook.com", "www.facebook.com", "instagram.com", "www.instagram.com", "linkedin.com", "www.linkedin.com", "x.com"].includes(u.hostname) ? u.toString() : undefined; } catch { return undefined; } }
