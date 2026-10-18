"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { signOutEverywhere } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/feedback/ToastProvider";

export function SessionsCard() {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  return (
    <>
      <Button variant="dangerOutline" onClick={() => setOpen(true)}>Sign out everywhere…</Button>
      <ConfirmDialog
        open={open}
        title="Sign out on every device?"
        message="Every browser and phone signed in to your account, including this one, will need to sign in again."
        confirmLabel="Sign out everywhere"
        loading={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          startTransition(async () => {
            const result = await signOutEverywhere();
            if (!result.ok) {
              showToast(result.error, "error");
              return;
            }
            await signOut({ callbackUrl: "/login" });
          })
        }
      />
    </>
  );
}
