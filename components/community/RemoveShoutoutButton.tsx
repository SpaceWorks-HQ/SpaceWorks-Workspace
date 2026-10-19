"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteShoutoutAction } from "@/app/actions/community";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";

export function RemoveShoutoutButton({ slug, id, recipient }: { slug: string; id: string; recipient: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="dangerQuiet" onClick={() => setOpen(true)} aria-label={`Remove the shoutout for ${recipient}`}>
        Remove…
      </Button>
      <ConfirmDialog
        open={open}
        title="Remove this shoutout?"
        message="It disappears from the wall. The notification they already got stays."
        confirmLabel="Remove shoutout"
        loading={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await deleteShoutoutAction(slug, { id });
            if (!result.ok) {
              showToast(result.error, "error");
              return;
            }
            setOpen(false);
            showToast("Shoutout removed.", "success");
            router.refresh();
          })
        }
      />
    </>
  );
}
