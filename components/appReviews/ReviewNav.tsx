import Link from "next/link";
import { PageHeader } from "@/components/ui/display";
export function ReviewNav({ slug, active, manage }: { slug: string; active: "inbox" | "insights" | "settings"; manage: boolean }) {
  return <><PageHeader title="App reviews" description="Hear from the people using your apps. Triage feedback and reply together." /><nav aria-label="App reviews" className="mb-6 flex gap-6 overflow-x-auto border-b border-line">{[["inbox", "Inbox", ""], ["insights", "Insights", "/insights"], ...(manage ? [["settings", "Settings", "/settings"]] : [])].map(([key, label, path]) => <Link key={key} href={`/w/${slug}/app-reviews${path}`} aria-current={active === key ? "page" : undefined} className={`inline-flex min-h-11 items-center border-b-2 text-label ${active === key ? "border-primary text-ink" : "border-transparent text-ink-muted hover:text-ink"}`}>{label}</Link>)}</nav></>;
}
export const platformLabel = (platform: "APPLE" | "GOOGLE") => platform === "APPLE" ? "App Store" : "Google Play";
export const triageLabels = { NEW: "New", IN_PROGRESS: "In progress", DONE: "Done", IGNORED: "Ignored" } as const;
export function Stars({ rating }: { rating: number }) { return <span className="text-label text-ink"><span aria-hidden="true" className="mr-2 text-accent-text">{"★".repeat(rating)}{"☆".repeat(5 - rating)}</span>{rating} out of 5</span>; }
