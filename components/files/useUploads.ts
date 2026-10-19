"use client";

import { useCallback, useState } from "react";
import { uploadFile, type UploadFields } from "@/lib/files/uploadClient";

export type UploadItem = { key: string; name: string; progress: number; status: "queued" | "uploading" | "done" | "error"; error?: string };
export type UploadJob = { file: File; fields: UploadFields };

/** Sequential upload queue with per-file progress and errors (one request per file). */
export function useUploads(slug: string, onDone: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);

  const update = (key: string, patch: Partial<UploadItem>) => setItems((list) => list.map((item) => (item.key === key ? { ...item, ...patch } : item)));

  const start = useCallback(
    async (jobs: UploadJob[]) => {
      if (jobs.length === 0) return;
      const queued = jobs.map((job, index) => ({ job, key: `${Date.now()}-${index}-${job.file.name}` }));
      setItems((list) => [...list.filter((item) => item.status !== "done"), ...queued.map(({ key, job }) => ({ key, name: job.file.name, progress: 0, status: "queued" as const }))]);
      setBusy(true);
      let uploaded = 0;
      for (const { key, job } of queued) {
        update(key, { status: "uploading" });
        const result = await uploadFile(slug, job.file, job.fields, (progress) => update(key, { progress }));
        if (result.ok) {
          uploaded += 1;
          update(key, { status: "done", progress: 1 });
        } else {
          update(key, { status: "error", error: result.error });
        }
      }
      setBusy(false);
      if (uploaded > 0) onDone();
    },
    [slug, onDone],
  );

  const dismiss = (key: string) => setItems((list) => list.filter((item) => item.key !== key));
  const clearFinished = () => setItems((list) => list.filter((item) => item.status === "uploading" || item.status === "queued"));

  return { items, busy, start, dismiss, clearFinished };
}
