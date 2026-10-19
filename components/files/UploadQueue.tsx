"use client";

import { X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/display";
import type { UploadItem } from "./useUploads";

/** Live list of uploads: progress while sending, then a word for the outcome. */
export function UploadQueue({ items, onDismiss, onClear }: { items: UploadItem[]; onDismiss: (key: string) => void; onClear: () => void }) {
  if (items.length === 0) return null;
  const finished = items.every((item) => item.status === "done" || item.status === "error");
  return (
    <section aria-label="Uploads" className="rounded-xl border border-line bg-panel p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-label text-ink">Uploads</h2>
        {finished ? <Button size="sm" variant="quiet" onClick={onClear}>Clear list</Button> : null}
      </div>
      <ul className="flex flex-col gap-3" aria-live="polite">
        {items.map((item) => (
          <li key={item.key} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-body-ui text-ink">{item.name}</span>
                <span className={item.status === "error" ? "shrink-0 text-caption text-danger-fg" : "shrink-0 text-caption tabular-nums text-ink-muted"}>
                  {item.status === "queued" ? "Waiting" : item.status === "uploading" ? `${Math.round(item.progress * 100)}%` : item.status === "done" ? "Uploaded" : "Not uploaded"}
                </span>
              </div>
              {item.status === "error" ? (
                <p className="mt-1 text-caption text-danger-fg">{item.error}</p>
              ) : (
                <ProgressBar className="mt-1.5" value={item.progress} max={1} tone={item.status === "done" ? "success" : "accent"} label={`Upload progress for ${item.name}`} />
              )}
            </div>
            {item.status === "done" || item.status === "error" ? (
              <IconButton label={`Dismiss ${item.name}`} size="sm" onClick={() => onDismiss(item.key)}><X /></IconButton>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
