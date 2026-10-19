"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreDocAction, restoreRevisionAction } from "@/app/actions/docs";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

export function RestoreDocButton({ slug, docId }: { slug: string; docId: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await restoreDocAction(slug, { docId });
          if (!result.ok) showToast(result.error, "error");
          else {
            showToast("Page restored.", "success");
            router.push(`/w/${slug}/docs/${docId}`);
          }
        })
      }
    >
      Restore
    </Button>
  );
}

export function RestoreRevisionButton({ slug, docId, revisionId, label }: { slug: string; docId: string; revisionId: string; label: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Restore this version…</Button>
      <ConfirmDialog
        open={open}
        destructive={false}
        title="Restore this version?"
        message={`The page goes back to the version from ${label}. Nothing is lost: the current text stays in the history.`}
        confirmLabel="Restore version"
        loading={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await restoreRevisionAction(slug, { docId, revisionId });
            setOpen(false);
            if (!result.ok) showToast(result.error, "error");
            else {
              showToast("Version restored.", "success");
              router.push(`/w/${slug}/docs/${docId}`);
            }
          })
        }
      />
    </>
  );
}
