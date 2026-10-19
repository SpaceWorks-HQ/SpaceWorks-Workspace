"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelEventAction } from "@/app/actions/community";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

export function CancelEventButton({ slug, eventId, title, attendees }: { slug: string; eventId: string; title: string; attendees: number }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="dangerOutline" onClick={() => setOpen(true)}>Cancel event…</Button>
      <ConfirmDialog
        open={open}
        title={`Cancel ${title}?`}
        message={attendees > 0 ? `We'll let the ${attendees === 1 ? "person" : `${attendees} people`} who replied know. This can't be undone.` : "It stays on the calendar marked as cancelled. This can't be undone."}
        confirmLabel="Cancel event"
        cancelLabel="Keep it"
        loading={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await cancelEventAction(slug, { id: eventId });
            if (!result.ok) {
              showToast(result.error, "error");
              return;
            }
            setOpen(false);
            showToast("Event cancelled.", "success");
            router.refresh();
          })
        }
      />
    </>
  );
}
