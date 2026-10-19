"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deletePostAction, publishPostAction, savePostAction, schedulePostAction, setCoverAction, unpublishPostAction } from "@/app/actions/blog";
import { useToast } from "@/components/feedback/ToastProvider";
import { RichTextEditor } from "@/components/blog/RichTextEditor";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Card, CardHeader, Chip, DangerZone } from "@/components/ui/display";
import { Field, Input, Textarea } from "@/components/ui/field";
import { EXCERPT_MAX, postSlugFromTitle, SEO_DESCRIPTION_MAX, SEO_TITLE_MAX, seoLengthHint, TITLE_MAX, type PostStatusWord } from "@/lib/blog/rules";
import { cn } from "@/lib/cn";

export type EditablePost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  contentHtml: string;
  seoTitle: string;
  seoDescription: string;
  coverFileId: string | null;
  state: PostStatusWord;
  /** "Wed 21 Oct, 9:00 AM IST" for scheduled/published posts. */
  whenLabel: string | null;
  publicUrl: string | null;
};

const STATE_TONE = { Draft: "neutral", Scheduled: "info", Published: "success" } as const;

function Hint({ value, max }: { value: string; max: number }) {
  const hint = seoLengthHint(value, max);
  return <span className={cn(hint.tone === "long" ? "text-danger-fg" : "text-ink-muted")}>{hint.message}</span>;
}

export function PostEditor({ slug, post, blogPrefix, blogEnabled, defaultScheduleAt, listHref }: { slug: string; post: EditablePost; blogPrefix: string; blogEnabled: boolean; defaultScheduleAt: string; listHref: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [values, setValues] = useState({ title: post.title, slug: post.slug, excerpt: post.excerpt, contentHtml: post.contentHtml, seoTitle: post.seoTitle, seoDescription: post.seoDescription });
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [dialog, setDialog] = useState<null | "schedule" | "delete" | "unpublish">(null);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleAt);
  const [scheduleError, setScheduleError] = useState<string | undefined>();
  const coverInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof typeof values>(key: K, value: (typeof values)[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const save = async (): Promise<boolean> => {
    const result = await savePostAction(slug, { postId: post.id, ...values });
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      showToast(result.error, "error");
      return false;
    }
    setErrors({});
    setDirty(false);
    return true;
  };

  const run = (work: () => Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string[]> }>, success: string, opts: { saveFirst?: boolean; onError?: (r: { error?: string; fieldErrors?: Record<string, string[]> }) => void } = {}) =>
    startTransition(async () => {
      if (opts.saveFirst && dirty && !(await save())) return;
      const result = await work();
      if (!result.ok) {
        if (opts.onError) opts.onError(result);
        else showToast(result.error ?? "Couldn't save. Try again.", "error");
        return;
      }
      setDialog(null);
      showToast(success, "success");
      router.refresh();
    });

  const uploadCover = (file: File | null) =>
    startTransition(async () => {
      const form = new FormData();
      form.set("postId", post.id);
      if (file) form.set("cover", file);
      else form.set("remove", "1");
      const result = await setCoverAction(slug, form);
      if (coverInput.current) coverInput.current.value = "";
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      showToast(file ? "Cover updated." : "Cover removed.", "success");
      router.refresh();
    });

  const live = post.state === "Published";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <form
        className="flex min-w-0 flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            if (await save()) {
              showToast(live ? "Saved. The live post is updated." : "Draft saved.", "success");
              router.refresh();
            }
          });
        }}
      >
        <Field label="Title" required error={errors.title?.[0]}>
          <Input
            value={values.title}
            maxLength={TITLE_MAX}
            className="text-h4 font-semibold"
            onChange={(event) => {
              const next = event.target.value;
              // Follow the title until the post is live or the address was edited by hand.
              if (!live && values.slug === postSlugFromTitle(values.title)) set("slug", postSlugFromTitle(next));
              set("title", next);
            }}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span id="post-body-label" className="text-label text-ink">Post</span>
          <RichTextEditor initialHtml={post.contentHtml} labelledBy="post-body-label" onChange={(html) => set("contentHtml", html)} />
          {errors.contentHtml?.[0] ? <p className="text-caption text-danger-fg">{errors.contentHtml[0]}</p> : null}
        </div>
        <Field label="Excerpt" optional helperText="One or two sentences for the blog index and the feed." error={errors.excerpt?.[0]}>
          <Textarea value={values.excerpt} onChange={(event) => set("excerpt", event.target.value)} rows={3} maxLength={EXCERPT_MAX} />
        </Field>
        <Card as="section">
          <CardHeader title="Search and sharing" description="How the post looks in search results and when shared." />
          <div className="flex flex-col gap-4">
            <Field label="Search title" optional helperText={<Hint value={values.seoTitle} max={SEO_TITLE_MAX} />} error={errors.seoTitle?.[0]}>
              <Input value={values.seoTitle} onChange={(event) => set("seoTitle", event.target.value)} maxLength={SEO_TITLE_MAX * 2} placeholder={values.title} />
            </Field>
            <Field label="Search description" optional helperText={<Hint value={values.seoDescription} max={SEO_DESCRIPTION_MAX} />} error={errors.seoDescription?.[0]}>
              <Textarea value={values.seoDescription} onChange={(event) => set("seoDescription", event.target.value)} rows={3} maxLength={SEO_DESCRIPTION_MAX * 2} placeholder={values.excerpt} />
            </Field>
            <Field label="Address" required helperText={<><span className="block break-all">{blogPrefix}{values.slug}</span>{live ? "Changing the address of a live post breaks links people already shared." : "Lowercase letters, numbers and hyphens."}</>} error={errors.slug?.[0]}>
              <Input value={values.slug} maxLength={60} onChange={(event) => set("slug", event.target.value.toLowerCase())} />
            </Field>
          </div>
        </Card>
        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {dirty ? <span className="mr-auto text-caption text-ink-muted" role="status">Unsaved changes</span> : null}
          <Button asChild variant="secondary">
            <Link href={`${listHref}/${post.id}/preview`} target="_blank">Preview</Link>
          </Button>
          <Button type="submit" variant={live ? "primary" : "secondary"} loading={pending && dialog === null}>
            {live ? "Update live post" : "Save draft"}
          </Button>
        </div>
      </form>

      <aside className="flex flex-col gap-5" aria-label="Publishing">
        <Card as="section">
          <CardHeader title="Status" action={<Chip tone={STATE_TONE[post.state]}>{post.state}</Chip>} />
          {post.whenLabel ? <p className="mb-3 text-body-ui text-ink-secondary">{post.state === "Scheduled" ? `Goes live ${post.whenLabel}.` : `Published ${post.whenLabel}.`}</p> : null}
          {!blogEnabled ? <p className="mb-3 text-caption text-ink-muted">The public blog is switched off in settings, so nothing is visible yet.</p> : null}
          {post.publicUrl && live && blogEnabled ? (
            <a href={post.publicUrl} target="_blank" rel="noreferrer" className="mb-3 block break-all text-body-ui text-accent-text underline underline-offset-4">
              {post.publicUrl}
            </a>
          ) : null}
          <div className="flex flex-col gap-2.5">
            {post.state === "Draft" ? (
              <>
                <Button variant="primary" fullWidth loading={pending} onClick={() => run(() => publishPostAction(slug, { postId: post.id }), "Published.", { saveFirst: true })}>
                  Publish now
                </Button>
                <Button variant="secondary" fullWidth onClick={() => setDialog("schedule")} disabled={pending}>
                  Schedule…
                </Button>
              </>
            ) : null}
            {post.state === "Scheduled" ? (
              <>
                <Button variant="primary" fullWidth loading={pending} onClick={() => run(() => publishPostAction(slug, { postId: post.id }), "Published.", { saveFirst: true })}>
                  Publish now instead
                </Button>
                <Button variant="secondary" fullWidth onClick={() => run(() => unpublishPostAction(slug, { postId: post.id }), "Schedule cancelled. It's a draft again.")} disabled={pending}>
                  Cancel schedule
                </Button>
              </>
            ) : null}
            {live ? (
              <Button variant="secondary" fullWidth onClick={() => setDialog("unpublish")} disabled={pending}>
                Unpublish…
              </Button>
            ) : null}
          </div>
        </Card>

        <Card as="section">
          <CardHeader title="Cover image" description="2:1 works best, at least 1200 × 600. PNG, JPEG, WebP or GIF up to 8 MB." />
          {post.coverFileId ? (
            // eslint-disable-next-line @next/next/no-img-element -- private file route, not an optimisable public asset
            <img src={`/api/files/${post.coverFileId}`} alt="" className="mb-3 aspect-[2/1] w-full rounded-lg border border-line object-cover" />
          ) : (
            <div aria-hidden className="mb-3 aspect-[2/1] w-full rounded-lg bg-highlight-soft" />
          )}
          <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" id={`cover-${post.id}`} onChange={(event) => uploadCover(event.target.files?.[0] ?? null)} />
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => coverInput.current?.click()} disabled={pending}>
              {post.coverFileId ? "Replace" : "Upload cover"}
            </Button>
            {post.coverFileId ? (
              <Button variant="quiet" size="sm" onClick={() => uploadCover(null)} disabled={pending}>
                Remove
              </Button>
            ) : null}
          </div>
        </Card>

        <DangerZone title="Delete post" description="Removes the post and its cover for good." action={<Button variant="danger" onClick={() => setDialog("delete")}>Delete…</Button>} />
      </aside>

      <Dialog open={dialog === "schedule"} onOpenChange={(open) => !pending && setDialog(open ? "schedule" : null)}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              run(() => schedulePostAction(slug, { postId: post.id, publishAt: scheduleAt }), "Scheduled.", {
                saveFirst: true,
                onError: (result) => setScheduleError(result.fieldErrors?.publishAt?.[0] ?? result.error),
              });
            }}
          >
            <DialogHeader title="Schedule this post" description="It goes live on its own at this time, in the workspace time zone." />
            <DialogBody>
              <Field label="Publish at" error={scheduleError}>
                <Input type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDialog(null)} disabled={pending}>Cancel</Button>
              <Button type="submit" variant="primary" loading={pending}>Schedule</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={dialog === "unpublish"}
        title="Unpublish this post?"
        message="It disappears from the public blog and the feed, and goes back to drafts."
        confirmLabel="Unpublish"
        loading={pending}
        onConfirm={() => run(() => unpublishPostAction(slug, { postId: post.id }), "Unpublished. It's a draft again.")}
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        title="Delete this post?"
        message="This can't be undone."
        confirmLabel="Delete post"
        loading={pending}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deletePostAction(slug, { postId: post.id });
            if (!result.ok) {
              showToast(result.error, "error");
              return;
            }
            showToast("Post deleted.", "success");
            router.push(listHref);
            router.refresh();
          })
        }
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}
