import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/permissions";
import { getReview, reviewMembers } from "@/lib/appReviews/queries";
import { formatDayTime } from "@/lib/format/datetime";
import { PageHeader, Card, Chip } from "@/components/ui/display";
import { ReviewControls } from "@/components/appReviews/ReviewControls";
import { Stars, platformLabel } from "@/components/appReviews/ReviewNav";

export default async function ReviewDetailPage({ params }: PageProps<"/w/[workspaceSlug]/app-reviews/[reviewId]">) {
  const { workspaceSlug, reviewId } = await params;
  const ctx = await requireWorkspace(workspaceSlug, "MEMBER");
  const [review, members] = await Promise.all([getReview(ctx, reviewId), reviewMembers(ctx)]); if (!review) notFound();
  return <div className="min-w-0 space-y-5 [overflow-wrap:anywhere]"><Link href={`/w/${workspaceSlug}/app-reviews`} className="inline-flex min-h-11 items-center text-label text-accent-text hover:underline">Back to App reviews</Link><PageHeader title={review.title || `Review from ${review.author}`} description={`${review.app.name} · ${platformLabel(review.platform)}`} />
    <Card><Stars rating={review.rating} /><p className="mt-4 whitespace-pre-wrap break-words text-body">{review.body}</p><dl className="mt-5 grid gap-3 text-caption text-ink-muted sm:grid-cols-2"><div><dt className="font-semibold">Author</dt><dd>{review.author}</dd></div><div><dt className="font-semibold">Posted · {ctx.workspace.timezone}</dt><dd>{formatDayTime(review.storeCreatedAt, ctx.workspace.timezone)}</dd></div><div><dt className="font-semibold">Language / territory</dt><dd>{review.language ?? "Not provided"} / {review.territory ?? "Not provided"}</dd></div><div><dt className="font-semibold">Updated · {ctx.workspace.timezone}</dt><dd>{formatDayTime(review.storeUpdatedAt, ctx.workspace.timezone)}</dd></div><div><dt className="font-semibold">App version</dt><dd>{review.appVersion ?? "Not provided"}</dd></div></dl></Card>
    {review.replyBody ? <Card><h2 className="mb-2 text-h4">Current store reply</h2><Chip tone={review.replyPublishState === "PUBLISHED" ? "success" : "warning"}>{review.replyPublishState === "PUBLISHED" ? "Published" : review.replyPublishState === "PENDING" ? "Waiting for Apple" : "Publish state unknown"}</Chip><p className="mt-3 whitespace-pre-wrap break-words">{review.replyBody}</p></Card> : null}
    <ReviewControls slug={workspaceSlug} review={review} members={members} />
    <Card><h2 className="mb-4 text-h4">Reply attempts</h2>{review.attempts.length ? <ol className="divide-y divide-line">{review.attempts.map(a => <li key={a.id} className="py-3"><div className="flex flex-wrap items-center gap-3"><Chip tone={a.status === "FAILED" ? "danger" : a.status === "SENT" ? "success" : "warning"}>{a.status === "SENT" ? "Sent" : a.status === "FAILED" ? "Failed" : "Sending"}</Chip><span className="text-caption text-ink-muted">{a.source === "SLACK" ? "Slack" : "Workspace"} · {formatDayTime(a.createdAt, ctx.workspace.timezone)} · {members.find(m => m.userId === a.actorId)?.user.name ?? "Former member"}</span></div><p className="mt-2 whitespace-pre-wrap break-words text-body-ui">{a.body}</p>{a.error ? <p className="mt-2 text-caption text-danger-fg">{a.error}</p> : null}</li>)}</ol> : <p className="text-body-ui text-ink-muted">No replies sent yet.</p>}</Card>
  </div>;
}
