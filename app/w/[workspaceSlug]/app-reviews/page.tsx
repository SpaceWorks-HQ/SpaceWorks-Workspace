import Link from "next/link";
import { requireWorkspace } from "@/lib/permissions";
import { canManageAppReviews } from "@/lib/roles";
import { listReviews, reviewMembers } from "@/lib/appReviews/queries";
import { ReviewTaskButton } from "@/components/appReviews/ReviewTaskButton";
import { formatRelativeTime } from "@/lib/format/datetime";
import { ReviewNav, Stars, platformLabel, triageLabels } from "@/components/appReviews/ReviewNav";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, Chip } from "@/components/ui/display";
import { Field, Input, Dropdown } from "@/components/ui/field";

export default async function AppReviewsPage({ params, searchParams }: PageProps<"/w/[workspaceSlug]/app-reviews">) {
  const { workspaceSlug } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  const raw = Object.fromEntries(Object.entries(await searchParams).filter(([, v]) => typeof v === "string" && v !== ""));
  const [data, members] = await Promise.all([listReviews(ctx, raw), reviewMembers(ctx)]);
  const manage = canManageAppReviews(ctx.membership);
  if (!data) return <><ReviewNav slug={workspaceSlug} active="inbox" manage={manage} /><p>These filters aren&apos;t valid. <Link className="underline" href={`/w/${workspaceSlug}/app-reviews`}>Clear filters</Link></p></>;
  const f = data.filters;
  function pageHref(page: number) { return `?${new URLSearchParams({ ...raw as Record<string, string>, page: String(page) })}`; }
  return <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]"><ReviewNav slug={workspaceSlug} active="inbox" manage={manage} />
    <Card><form className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
      <Field label="Search reviews"><Input name="q" defaultValue={f.q} maxLength={200} placeholder="Text or author" /></Field>
      <Field label="App"><Dropdown name="app" defaultValue={f.app ?? ""}><option value="">All apps</option>{data.apps.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</Dropdown></Field>
      <Field label="Platform"><Dropdown name="platform" defaultValue={f.platform ?? ""}><option value="">All platforms</option><option value="APPLE">App Store</option><option value="GOOGLE">Google Play</option></Dropdown></Field>
      <Field label="Rating"><Dropdown name="rating" defaultValue={f.rating ?? ""}><option value="">All ratings</option>{[1, 2, 3, 4, 5].map(n => <option value={n} key={n}>{n} out of 5</option>)}</Dropdown></Field>
      <Field label="Status"><Dropdown name="status" defaultValue={f.status ?? ""}><option value="">All statuses</option>{Object.entries(triageLabels).map(([v, name]) => <option key={v} value={v}>{name}</option>)}</Dropdown></Field>
      <Field label="Reply"><Dropdown name="replied" defaultValue={f.replied ?? ""}><option value="">All reviews</option><option value="no">Unreplied</option><option value="yes">Replied</option></Dropdown></Field>
      <Field label="Language"><Input name="language" defaultValue={f.language} placeholder="e.g. en" maxLength={30} /></Field>
      <Field label="Sort"><Dropdown name="sort" defaultValue={f.sort}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="lowest">Lowest rating first</option><option value="highest">Highest rating first</option></Dropdown></Field>
      <div className="flex flex-wrap gap-3 sm:col-span-2 md:col-span-4"><Button variant="primary" type="submit">Apply filters</Button><Link className={buttonClasses({ variant: "quiet" })} href={`/w/${workspaceSlug}/app-reviews`}>Clear filters</Link></div>
    </form></Card>
    <p className="text-caption text-ink-muted">{data.total} {data.total === 1 ? "review" : "reviews"} · Times in {ctx.workspace.timezone}</p>
    {data.reviews.length ? <div className="space-y-3">{data.reviews.map(r => <Card as="article" key={r.id}><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Stars rating={r.rating} /><div className="flex flex-wrap gap-2"><Chip tone={r.status === "DONE" ? "success" : "neutral"}>{triageLabels[r.status]}</Chip><Chip tone={r.replyStatus === "SENT" ? "success" : r.replyStatus === "FAILED" ? "danger" : "neutral"}>{r.replyStatus === "SENT" ? r.replyPublishState === "PUBLISHED" ? "Replied" : "Awaiting publication" : r.replyStatus === "SENDING" ? "Sending" : r.replyStatus === "FAILED" ? "Reply failed" : "Unreplied"}</Chip></div></div><h2 className="text-title"><Link href={`/w/${workspaceSlug}/app-reviews/${r.id}`} className="text-accent-text underline-offset-4 hover:underline">{r.title || `Review from ${r.author}`}</Link></h2><p className="mt-2 line-clamp-3 whitespace-pre-wrap break-words text-body-ui">{r.body}</p><p className="mt-3 text-caption text-ink-muted">{r.app.name} · {platformLabel(r.platform)} · {r.author} · {formatRelativeTime(r.storeCreatedAt, ctx.workspace.timezone)}</p><p className="mt-2 text-caption text-ink-muted">Assignee: {r.assigneeId ? members.find(m => m.userId === r.assigneeId)?.user.name ?? "Former member" : "Unassigned"}</p>{r.tags.length ? <p className="mt-2 text-caption text-ink-muted">Tags: {r.tags.join(", ")}</p> : null}<ReviewTaskButton slug={workspaceSlug} reviewId={r.id} linked={Boolean(r.linkedTaskId)} /></Card>)}</div> : <Card><p className="text-body-ui">{Object.keys(raw).length ? "No reviews match these filters. Try clearing them." : "No reviews yet. They show up here within 15 minutes of being posted."}</p>{manage ? <Link href={`/w/${workspaceSlug}/app-reviews/settings`} className={buttonClasses({ variant: "quiet", className: "mt-2" })}>Connect an app</Link> : null}</Card>}
    {data.total > 30 ? <nav aria-label="Review pages" className="flex items-center gap-4">{f.page > 1 ? <Link className={buttonClasses()} href={pageHref(f.page - 1)}>Previous</Link> : null}<span className="text-label">Page {f.page} of {Math.ceil(data.total / 30)}</span>{f.page * 30 < data.total ? <Link className={buttonClasses()} href={pageHref(f.page + 1)}>Next</Link> : null}</nav> : null}
  </div>;
}
