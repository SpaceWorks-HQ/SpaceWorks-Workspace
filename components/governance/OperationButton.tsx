"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { governanceOperation } from "@/app/actions/governance";

export function OperationButton({
  slug,
  input,
  children,
  confirm,
}: {
  slug: string;
  input: Record<string, unknown>;
  children: string;
  confirm?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const router = useRouter();
  function run() {
    start(async () => {
      try {
        const result = await governanceOperation(slug, input);
        if (!result.ok) setError(result.error);
        else {
          setError("");
          if (input.op === "next" && result.data)
            router.push(`?edit=${result.data.id}`);
          else if (input.op === "archive") router.push("?");
          router.refresh();
        }
      } catch {
        setError("Couldn't save. Try again.");
      }
    });
  }
  return (
    <div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={() => (confirm ? setOpen(true) : run())}
      >
        {pending ? "Saving" : children}
      </Button>
      {error ? (
        <p role="alert" className="text-danger-fg">
          {error}
        </p>
      ) : null}
      {confirm ? (
        <ConfirmDialog
          open={open}
          title={children}
          message={confirm}
          confirmLabel={children}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            run();
          }}
        />
      ) : null}
    </div>
  );
}
