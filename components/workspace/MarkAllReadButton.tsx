"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markNotificationsReadAction } from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/feedback/ToastProvider";

export function MarkAllReadButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={disabled || done}
      loading={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markNotificationsReadAction({});
          if (!result.ok) {
            showToast(result.error, "error");
            return;
          }
          setDone(true);
          router.refresh();
        })
      }
    >
      Mark all as read
    </Button>
  );
}
