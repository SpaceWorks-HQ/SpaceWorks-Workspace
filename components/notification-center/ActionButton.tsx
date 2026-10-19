"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { ActionResult } from "@/lib/actionResult";
export function ActionButton({
  action,
  children,
  confirm,
  disabled = false,
}: {
  action: () => Promise<ActionResult>;
  children: React.ReactNode;
  confirm?: string;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const run = () =>
    start(async () => {
      try {
        const r = await action();
        if (!r.ok) setError(r.error);
        else {
          setError("");
          setOpen(false);
          router.refresh();
        }
      } catch {
        setError("Couldn't save. Try again.");
      }
    });
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant={confirm ? "danger" : "secondary"}
        disabled={disabled}
        loading={pending}
        onClick={() => (confirm ? setOpen(true) : run())}
      >
        {children}
      </Button>
      {error ? (
        <span role="alert" className="text-caption text-danger-fg">
          {error}
        </span>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          open={open}
          title={confirm}
          message="This change cannot be undone."
          loading={pending}
          confirmLabel="Remove"
          onCancel={() => setOpen(false)}
          onConfirm={run}
        />
      ) : null}
    </span>
  );
}
