"use client";

import { useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { removeTaskAttachmentAction, uploadTaskAttachmentAction } from "@/app/actions/tasks";
import { Button, IconButton } from "@/components/ui/button";
import { formatRelativeTime } from "@/lib/format/datetime";
import type { TaskDetailDTO } from "@/lib/tasks/types";
import type { RunAction } from "./useTaskRunner";

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Files attached to the task (stored privately, downloaded through /api/files/[id]). */
export function TaskAttachments({ slug, task, run }: { slug: string; task: TaskDetailDTO; run: RunAction }) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const [busy, setBusy] = useState(false);
  const canEdit = task.permissions.canEdit && !task.archivedAt;
  if (task.attachments.length === 0 && !canEdit) return null;

  const upload = async (files: FileList | null) => {
    if (!files?.length || uploading.current || !canEdit) return;
    uploading.current = true;
    setBusy(true);
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const form = new FormData();
        form.set("taskId", task.id);
        form.set("file", file);
        await run(() => uploadTaskAttachmentAction(slug, form), `Attached ${file.name}.`);
      }
    } finally {
      uploading.current = false;
      setBusy(false);
      if (input.current) input.current.value = "";
      if (camera.current) camera.current.value = "";
    }
  };

  return (
    <section aria-labelledby={`files-${task.id}`} className="flex flex-col gap-3"
      onDragOver={event => { if (canEdit) event.preventDefault(); }}
      onDrop={event => { if (canEdit) { event.preventDefault(); void upload(event.dataTransfer.files); } }}>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id={`files-${task.id}`} className="text-title text-ink">
          Attachments
        </h3>
        {canEdit ? (
          <>
            <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={(event) => void upload(event.target.files)} />
            <input ref={camera} type="file" accept="image/*,application/pdf" capture="environment" multiple className="sr-only" tabIndex={-1} aria-hidden onChange={event => void upload(event.target.files)} />
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => camera.current?.click()}>Add photo or PDF</Button>
            <Button variant="ghost" size="sm" startIcon={null} loading={busy} loadingLabel="Uploading" onClick={() => input.current?.click()}>
              Attach files
            </Button>
          </>
        ) : null}
      </div>
      {canEdit ? <p className="text-caption text-ink-muted">Drop up to 10 files here, choose files, or use your phone camera. Upload size and type limits apply.</p> : null}
      {task.attachments.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
          {task.attachments.map((file) => (
            <li key={file.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <a href={file.url} target="_blank" rel="noopener" aria-label={`${file.contentType.startsWith("image/") || file.contentType === "application/pdf" ? "Preview" : "Download"} ${file.filename}`} className="min-w-0 flex-1 text-body-ui text-ink underline-offset-4 hover:underline">
                <span className="flex items-center gap-1.5 truncate">
                  <span className="truncate">{file.filename}</span>
                  <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ink-muted" />
                </span>
                <span className="block text-caption text-ink-muted">
                  {size(file.size)} · {file.uploadedBy?.name ?? "Former member"} · {formatRelativeTime(file.createdAt, task.timeZone)}
                </span>
              </a>
              {file.canDelete ? (
                <IconButton label={`Remove ${file.filename}`} onClick={() => void run(() => removeTaskAttachmentAction(slug, { taskId: task.id, fileId: file.id }), "Attachment removed.")}>
                  <span aria-hidden="true" className="inline-flex items-center justify-center text-xs font-semibold">×</span>
                </IconButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-ui text-ink-muted">Add photos, schematics or datasheets. Images and PDFs open in a private preview.</p>
      )}
    </section>
  );
}
