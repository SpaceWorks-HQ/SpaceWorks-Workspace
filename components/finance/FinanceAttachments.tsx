"use client";
import Image from "next/image";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadFinanceFilesAction,
  removeFinanceFileAction,
} from "@/app/actions/finance-tools";
import { Button, buttonClasses } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { Callout } from "@/components/ui/display";
import type { AttachmentType } from "@/lib/finance/tools-rules";

export type FinanceFile = {
  id: string;
  filename: string;
  contentType: string;
  attachmentId?: string;
};
export function FilePreviews({ files }: { files: FinanceFile[] }) {
  const [preview, setPreview] = useState<string | null>(null);
  return (
    <ul className="flex flex-col gap-2">
      {files.map((f) => (
        <li key={f.id} className="min-w-0 rounded-md border border-line p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 break-all text-body-ui">{f.filename}</span>
            <div className="flex flex-wrap gap-2">
              {f.contentType.startsWith("image/") ? (
                <Button
                  type="button"
                  variant="quiet"
                  aria-expanded={preview === f.id}
                  onClick={() => setPreview(preview === f.id ? null : f.id)}
                >
                  Preview image
                </Button>
              ) : (
                <a
                  href={`/api/files/${f.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClasses({ variant: "quiet" })}
                >
                  Preview PDF<span className="sr-only"> (opens a new tab)</span>
                </a>
              )}
              <a
                href={`/api/files/${f.id}?download=1`}
                className={buttonClasses({ variant: "quiet" })}
              >
                Download
              </a>
            </div>
          </div>
          {preview === f.id ? (
            <Image
              src={`/api/files/${f.id}`}
              alt={`Receipt: ${f.filename}`}
              width={720}
              height={960}
              unoptimized
              className="mt-3 h-auto max-h-[60vh] w-full object-contain"
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}
export function FinanceAttachments({
  slug,
  type,
  recordId,
  initial = [],
  editable = true,
  onChange,
  onBusyChange,
}: {
  slug: string;
  type: AttachmentType;
  recordId?: string;
  initial?: FinanceFile[];
  editable?: boolean;
  onChange?: (files: FinanceFile[]) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [files, setFiles] = useState(initial),
    [pending, start] = useTransition(),
    [error, setError] = useState("");
  const [stageId] = useState(() => crypto.randomUUID());
  const id = useId(),
    router = useRouter();
  function upload(selected: File[]) {
    setError("");
    if (!selected.length) return;
    if (selected.length + files.length > 10) {
      setError("Keep up to ten files per record.");
      return;
    }
    if (
      selected.some((f) => f.size > 10 * 1024 * 1024) ||
      selected.reduce((n, f) => n + f.size, 0) > 24 * 1024 * 1024
    ) {
      setError("Choose files up to 10 MB each and 24 MB altogether.");
      return;
    }
    onBusyChange?.(true);
    start(async () => {
      const form = new FormData();
      form.set("recordType", type);
      if (recordId || type === "STAGED")
        form.set("recordId", recordId ?? stageId);
      for (const f of selected) form.append("files", f);
      try {
        const result = await uploadFinanceFilesAction(slug, form);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        const next = [...files, ...result.data];
        setFiles(next);
        onChange?.(next);
        if (type !== "STAGED") router.refresh();
      } catch {
        setError("Couldn't upload. Try again.");
      } finally {
        onBusyChange?.(false);
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
            Receipts and proof
          </label>
          <p id={`${id}-hint`} className="mb-3 text-caption text-ink-muted">
            Drop images or PDFs here, or choose files. Up to ten, 10 MB each.
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
            Take a receipt photo
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
      {pending ? <p role="status">Saving files</p> : null}
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}
      <FilePreviews files={files} />
      {editable
        ? files
            .filter((f) => f.attachmentId)
            .map((f) => (
              <Button
                key={f.id}
                type="button"
                variant="quiet"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    try {
                      const r = await removeFinanceFileAction(
                        slug,
                        f.attachmentId!,
                      );
                      if (!r.ok) {
                        setError(r.error);
                        return;
                      }
                      const next = files.filter((a) => a.id !== f.id);
                      setFiles(next);
                      onChange?.(next);
                      router.refresh();
                    } catch {
                      setError("Couldn't remove the file. Try again.");
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
