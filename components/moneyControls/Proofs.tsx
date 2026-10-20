"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadMoneyControlFilesAction,
  removeMoneyControlFileAction,
  reconcileMoneyMovementAction,
} from "@/app/actions/money-controls";
import {
  FilePreviews,
  type FinanceFile,
} from "@/components/finance/FinanceAttachments";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
export function Proofs({
  slug,
  recordId,
  files,
  editable,
  removable,
}: {
  slug: string;
  recordId: string;
  files: FinanceFile[];
  editable: boolean;
  removable: boolean;
}) {
  const id = useId(),
    router = useRouter(),
    [pending, start] = useTransition(),
    [error, setError] = useState("");
  function upload(selected: File[]) {
    if (!selected.length) return;
    if (
      selected.length > 10 ||
      selected.some((f) => f.size > 10 * 1024 * 1024) ||
      selected.reduce((n, f) => n + f.size, 0) > 24 * 1024 * 1024
    ) {
      setError(
        "Choose up to ten images or PDFs, 10 MB each and 24 MB altogether.",
      );
      return;
    }
    start(async () => {
      setError("");
      try {
        const form = new FormData();
        form.set("recordId", recordId);
        selected.forEach((f) => form.append("files", f));
        const r = await uploadMoneyControlFilesAction(slug, form);
        if (!r.ok) setError(r.error);
        else router.refresh();
      } catch {
        setError("Couldn't upload proof. Try again.");
      }
    });
  }
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {editable ? (
        <div
          className="rounded-lg border border-dashed border-line-strong p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (!pending) upload([...e.dataTransfer.files]);
          }}
        >
          <label htmlFor={id} className="text-label">
            Receipts and evidence
          </label>
          <p id={`${id}-hint`} className="mb-3 text-caption text-ink-muted">
            Drop images or PDFs, or choose files. Up to twenty per record, 10 MB
            each.
          </p>
          <Input
            id={id}
            type="file"
            accept="image/*,application/pdf"
            multiple
            disabled={pending}
            aria-describedby={`${id}-hint`}
            onChange={(e) => {
              upload([...(e.currentTarget.files ?? [])]);
              e.currentTarget.value = "";
            }}
          />
          <label htmlFor={`${id}-camera`} className="mt-3 block text-label">
            Take a photo
          </label>
          <Input
            id={`${id}-camera`}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            disabled={pending}
            onChange={(e) => {
              upload([...(e.currentTarget.files ?? [])]);
              e.currentTarget.value = "";
            }}
          />
        </div>
      ) : null}
      {pending ? <p role="status">Saving proof…</p> : null}
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}
      <FilePreviews files={files} />
      {editable && removable
        ? files.map((f) => (
            <Button
              key={f.id}
              type="button"
              variant="quiet"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  try {
                    const r = await removeMoneyControlFileAction(slug, f.id);
                    if (!r.ok) setError(r.error);
                    else router.refresh();
                  } catch {
                    setError("Couldn't remove the proof. Try again.");
                  }
                })
              }
            >
              Remove {f.filename}
            </Button>
          ))
        : null}
    </div>
  );
}
export function ReconcileMovement({ slug, id }: { slug: string; id: string }) {
  const router = useRouter(),
    [pending, start] = useTransition(),
    [error, setError] = useState("");
  return (
    <div>
      <Button
        variant="quiet"
        disabled={pending}
        onClick={() =>
          start(async () => {
            try {
              const r = await reconcileMoneyMovementAction(slug, id);
              if (!r.ok) setError(r.error);
              else router.refresh();
            } catch {
              setError("Couldn't mark this movement. Try again.");
            }
          })
        }
      >
        {pending ? "Saving…" : "Mark reconciled"}
      </Button>
      {error ? (
        <p role="alert" className="text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
