"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPostAction } from "@/app/actions/blog";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { TITLE_MAX } from "@/lib/blog/rules";

export function NewPostButton({ slug, listHref, label = "New post" }: { slug: string; listHref: string; label?: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await createPostAction(slug, { title });
                if (!result.ok || !result.data) {
                  setError(result.ok ? undefined : (result.fieldErrors?.title?.[0] ?? result.error));
                  if (!result.ok) showToast(result.error, "error");
                  return;
                }
                router.push(`${listHref}/${result.data.id}`);
              });
            }}
          >
            <DialogHeader title="Start a post" description="It stays a draft until you publish it." />
            <DialogBody>
              <Field label="Title" error={error}>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={TITLE_MAX} placeholder="What we built at build night #12" autoFocus />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
              <Button type="submit" variant="primary" loading={pending} disabled={!title.trim()}>Create draft</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
