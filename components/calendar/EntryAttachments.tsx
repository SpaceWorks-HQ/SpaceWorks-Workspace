"use client";

import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import type { CalendarData } from "./CalendarScreen";

export function EntryAttachments({ files, setFiles, preview, setPreview, entry }: {
  files: File[];
  setFiles: (files: File[]) => void;
  preview: string | null;
  setPreview: (id: string | null) => void;
  entry?: CalendarData["entries"][number];
}) {
  return (
    <>
      <div
        className="space-y-3 rounded-lg border border-dashed border-line-strong p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          setFiles(
            [...files, ...Array.from(e.dataTransfer.files)].slice(0, 20),
          );
        }}
      >
        <Field
          label="Files"
          optional
          helperText="Drop images or PDFs here, or choose files. Up to 20 files per record; 25 MB per file unless your instance sets a lower limit."
        >
          <Input
            type="file"
            multiple
            accept="image/*,application/pdf"
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </Field>
        <Field label="Take a photo" optional>
          <Input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            onChange={(e) =>
              setFiles(
                [...files, ...Array.from(e.target.files ?? [])].slice(
                  0,
                  20,
                ),
              )
            }
          />
        </Field>
        <ul>
          {files.map((file, i) => (
            <li
              key={i}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="break-all text-caption">{file.name}</span>
              <Button
                type="button"
                variant="quiet"
                onClick={() =>
                  setFiles(files.filter((_, index) => index !== i))
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </div>
      {entry?.fileIds.length ? (
        <div className="space-y-2">
          <h3 className="text-label">Attached files</h3>
          {entry.fileIds.map((id, i) => (
            <div key={id} className="flex flex-wrap gap-3">
              <Button
                type="button"
                variant="quiet"
                onClick={() => setPreview(id)}
              >
                Preview file {i + 1}
              </Button>
              <a
                href={`/api/files/${id}?download=1`}
                className="inline-flex min-h-11 items-center text-accent-text underline"
              >
                Download file {i + 1}
              </a>
            </div>
          ))}
        </div>
      ) : null}
      {preview && (
        <div>
          <a
            href={`/api/files/${preview}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center text-accent-text underline"
          >
            Open image or PDF preview
          </a>
          <Button
            type="button"
            variant="quiet"
            onClick={() => setPreview(null)}
          >
            Close preview
          </Button>
        </div>
      )}
    </>
  );
}
