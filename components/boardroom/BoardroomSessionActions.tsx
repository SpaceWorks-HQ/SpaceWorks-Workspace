"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteBoardroomSessionAction } from "@/app/actions/boardroom";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/feedback/ToastProvider";

export function BoardroomSessionActions({ slug, sessionId, canDelete, exportHref }: { slug: string; sessionId: string; canDelete: boolean; exportHref: string | null }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      {exportHref ? (
        <Button variant="secondary" asChild>
          <a href={exportHref} download>Download markdown</a>
        </Button>
      ) : null}
      {canDelete ? <Button variant="dangerOutline" onClick={() => setConfirming(true)}>Delete…</Button> : null}
      <ConfirmDialog
        open={confirming}
        title="Delete this session?"
        message="The question, transcript and outcome are removed for everyone."
        confirmLabel="Delete session"
        loading={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteBoardroomSessionAction(slug, { sessionId });
            if (!result.ok) {
              showToast(result.error, "error");
              return;
            }
            showToast("Session deleted.", "success");
            router.push(`/w/${slug}/boardroom`);
          })
        }
      />
    </>
  );
}
