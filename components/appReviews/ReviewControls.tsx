"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AppReview, AppReviewStatus } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/display";
import { Field, Input, Textarea, Dropdown } from "@/components/ui/field";
import { createAppReviewTaskAction, draftAppReviewReplyAction, sendAppReviewReplyAction, triageAppReviewAction } from "@/app/actions/appReviews";
import { REPLY_LIMITS, replyLength, validateReply } from "@/lib/appReviews/validation";
import { triageLabels } from "./ReviewNav";

export function ReviewControls({ slug, review, members }: { slug: string; review: AppReview; members: { userId: string; user: { name: string | null; email: string } }[] }) {
  const router = useRouter(); const [pending, start] = useTransition();
  const [body, setBody] = useState(review.replyBody ?? ""); const [triggerKey, setTriggerKey] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState(review.status); const [assignee, setAssignee] = useState(review.assigneeId ?? ""); const [tags, setTags] = useState(review.tags.join(", "));
  const [message, setMessage] = useState(""); const [failed, setFailed] = useState(false);
  function report(ok: boolean, text: string) { setFailed(!ok); setMessage(text); router.refresh(); }
  function run(work: () => Promise<void>) { start(async () => { try { await work(); } catch { report(false, "Couldn't complete that request. Reload to check its state before trying again."); } }); }
  return <div className="space-y-5">
    <Card><h2 className="mb-4 text-h4">Triage</h2><div className="grid gap-4 sm:grid-cols-2"><Field label="Status"><Dropdown value={status} onChange={e => setStatus(e.target.value as AppReviewStatus)}>{Object.entries(triageLabels).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</Dropdown></Field><Field label="Assignee"><Dropdown value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Unassigned</option>{members.map(m => <option key={m.userId} value={m.userId}>{m.user.name ?? m.user.email}</option>)}</Dropdown></Field><Field label="Tags" helperText="Separate tags with commas."><Input value={tags} onChange={e => setTags(e.target.value)} maxLength={800} /></Field></div>
      <div className="mt-4 flex flex-wrap gap-3"><Button disabled={pending} onClick={() => run(async () => { const result = await triageAppReviewAction(slug, { reviewId: review.id, status, assigneeId: assignee || null, tags: tags.split(",").map(t => t.trim()).filter(Boolean) }); report(result.ok, result.ok ? "Triage saved." : result.error); })}>Save triage</Button><Button disabled={pending || Boolean(review.linkedTaskId)} onClick={() => run(async () => { const result = await createAppReviewTaskAction(slug, { reviewId: review.id }); report(result.ok, result.ok ? `Task #${result.data?.number} created. Find it in My tasks or the linked project.` : result.error); })}>{review.linkedTaskId ? "Task linked" : "Create task"}</Button></div>
    </Card>
    <Card><h2 className="mb-2 text-h4">{review.replyStatus === "SENT" ? "Edit reply" : "Reply to this review"}</h2><p className="mb-4 text-caption text-ink-muted">Your reply is public. Review the text before sending.</p><Field label="Reply" helperText={`${replyLength(body)} of ${REPLY_LIMITS[review.platform]} characters`} error={body && validateReply(review.platform, body) ? validateReply(review.platform, body) : undefined}><Textarea value={body} onChange={e => { setBody(e.target.value); setTriggerKey(crypto.randomUUID()); }} rows={6} maxLength={REPLY_LIMITS[review.platform] * 2} disabled={pending || review.replyStatus === "SENDING"} /></Field>
      <div className="mt-4 flex flex-wrap gap-3"><Button variant="primary" disabled={pending || Boolean(validateReply(review.platform, body)) || review.replyStatus === "SENDING"} onClick={() => run(async () => { const result = await sendAppReviewReplyAction(slug, { reviewId: review.id, body, triggerKey }); report(result.ok, result.ok ? result.data?.state === "PUBLISHED" ? "Reply published." : result.data?.state === "PENDING" ? "Sent, waiting for Apple to publish." : "Sent. The publish state will be checked automatically." : result.error); })}>{pending ? "Working…" : review.replyStatus === "SENT" ? "Send edited reply" : "Send reply"}</Button><Button disabled={pending || review.replyStatus === "SENDING"} onClick={() => run(async () => { const result = await draftAppReviewReplyAction(slug, review.id); if (result.ok && result.data) { setBody(result.data.body); setTriggerKey(crypto.randomUUID()); } report(result.ok, result.ok ? "Draft ready. Review it, then press Send reply." : result.error); })}>Draft with assistant</Button></div>
      {review.replyStatus === "SENDING" ? <p className="mt-4 text-caption text-warning-fg">A send is in progress or its outcome is being checked. Check the store before attempting another reply.</p> : null}
    </Card>
    {message ? <p role={failed ? "alert" : "status"} className={failed ? "text-danger-fg" : "text-ink-secondary"}>{message}</p> : null}
  </div>;
}
