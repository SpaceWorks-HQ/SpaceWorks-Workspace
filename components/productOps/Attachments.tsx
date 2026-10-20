"use client";
import Image from "next/image";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import {
  uploadProductFile,
  removeProductFile,
} from "@/app/actions/productOps";
const fileUrl = (id: string, options: { download?: boolean } = {}) =>
  `/api/files/${encodeURIComponent(id)}${options.download ? "?download=1" : ""}`;
import { formatBytes } from "@/lib/files/versions";
export function Attachments({
  slug,
  recordId,
  locked,
  files,
  maxBytes,
  retain = false,
}: {
  slug: string;
  recordId: string;
  locked: boolean;
  maxBytes: number;
  retain?: boolean;
  files: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
  }>;
}) {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [remove, setRemove] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const id = useId();
  function upload(selected: File[]) {
    if (!selected.length || pending || locked) return;
    if (
      selected.length + files.length > 50 ||
      selected.some((f) => f.size > maxBytes)
    ) {
      setMessage("Use up to 50 images or PDFs, each within the upload limit.");
      return;
    }
    start(async () => {
      try {
        for (const [index, file] of selected.entries()) {
          setMessage(`Uploading ${index + 1} of ${selected.length}…`);
          const form = new FormData();
          form.set("recordId", recordId);
          form.set("file", file);
          const result = await uploadProductFile(slug, form);
          if (!result.ok) {
            setMessage(
              `${file.name}: ${result.error} Earlier files in this batch were kept.`,
            );
            router.refresh();
            return;
          }
        }
        setMessage("Files uploaded.");
        router.refresh();
      } catch {
        setMessage(
          "Couldn't upload. Refresh to see which files were saved, then try again.",
        );
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  }
  return (
    <section className="space-y-3" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="text-h3">
        Proof and attachments
      </h3>
      {!locked ? (
        <div
          className="space-y-3 rounded-lg border border-dashed border-line-strong p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            upload(Array.from(e.dataTransfer.files));
          }}
        >
          <label htmlFor={`${id}-files`} className="block text-label">
            Drop images or PDFs here, or choose files
          </label>
          <p id={`${id}-help`} className="text-caption text-ink-muted">
            Up to 50 files per record, {Math.floor(maxBytes / 1024 / 1024)} MB each. Files are private to
            people who can read this record.
          </p>
          <input
            id={`${id}-files`}
            aria-describedby={`${id}-help`}
            ref={input}
            type="file"
            accept="image/*,application/pdf"
            multiple
            disabled={pending}
            className="block min-h-11 w-full min-w-0 text-sm"
            onChange={(e) => upload(Array.from(e.target.files ?? []))}
          />
          <label htmlFor={`${id}-camera`} className="block text-label">
            Take a photo of proof
          </label>
          <input
            id={`${id}-camera`}
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            disabled={pending}
            className="block min-h-11 w-full min-w-0 text-sm"
            onChange={(e) => {
              upload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <p className="text-ink-muted">
          Attachments are locked on completed, reviewed and archived records.
        </p>
      )}
      {!files.length ? (
        <p className="text-ink-muted">No proof files yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {files.map((f) => (
            <li key={f.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <a
                  className="min-h-11 min-w-0 break-all py-3 text-accent-text underline"
                  href={fileUrl(f.id, { download: true })}
                >
                  {f.filename}
                </a>
                <span className="text-caption text-ink-muted">
                  {formatBytes(f.size)}
                </span>
                <Button
                  variant="quiet"
                  onClick={() => setPreview(preview === f.id ? null : f.id)}
                >
                  {preview === f.id ? "Close preview" : "Preview"}
                </Button>
                {!locked && !retain ? (
                  <Button
                    variant="quiet"
                    disabled={pending}
                    onClick={() => setRemove(f.id)}
                  >
                    Remove<span className="sr-only"> {f.filename}</span>
                  </Button>
                ) : null}
              </div>
              {preview === f.id ? (
                f.contentType === "application/pdf" ? (
                  <div>
                    <iframe
                      title={`Preview ${f.filename}`}
                      src={fileUrl(f.id)}
                      className="h-96 w-full rounded-lg border border-line"
                    />
                    <a
                      className="text-accent-text underline"
                      href={fileUrl(f.id)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open PDF preview
                    </a>
                  </div>
                ) : (
                  <Image
                    unoptimized
                    width={1024}
                    height={768}
                    src={fileUrl(f.id)}
                    alt={`Proof: ${f.filename}`}
                    className="max-h-96 max-w-full rounded-lg object-contain"
                  />
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
      <ConfirmDialog
        open={Boolean(remove)}
        title="Remove proof file"
        message="This file will no longer be available from the record."
        confirmLabel="Remove file"
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          const fileId = remove;
          setRemove(null);
          if (!fileId) return;
          start(async () => {
            try {
              const r = await removeProductFile(slug, recordId, fileId);
              setMessage(r.ok ? "File removed." : r.error);
              router.refresh();
            } catch {
              setMessage("Couldn't remove the file. Try again.");
            }
          });
        }}
      />
    </section>
  );
}
