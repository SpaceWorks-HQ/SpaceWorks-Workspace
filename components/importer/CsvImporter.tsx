"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { queueCsvImport } from "@/app/actions/exports";
import { parseCsv, mapLinkRows } from "@/lib/shell/csv";
import { Field, Input } from "@/components/ui/field";
import { Dropdown } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
export function CsvImporter({ slug }: { slug: string }) {
  const [headers, setHeaders] = useState<string[]>([]),
    [rows, setRows] = useState<string[][]>([]),
    [mapping, setMapping] = useState({
      title: "",
      url: "",
      description: "",
      tags: "",
    }),
    [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  let preview: ReturnType<typeof mapLinkRows> = [];
  try {
    if (mapping.title && mapping.url) preview = mapLinkRows(rows, mapping);
  } catch {}
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        for (const [key, value] of Object.entries(mapping)) f.set(key, value);
        start(async () => {
          try {
            const r = await queueCsvImport(slug, f);
            setMessage(
              r.ok ? "Import queued. Its result will appear below." : r.error,
            );
            if (r.ok) router.refresh();
          } catch {
            setMessage("Couldn't queue the import. Try again.");
          }
        });
      }}
    >
      <Field
        label="CSV file"
        helperText="Up to 1 MB and 1,000 records. Existing URLs are skipped."
      >
        <Input
          type="file"
          name="file"
          accept=".csv,text/csv"
          required
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            try {
              const data = parseCsv(await file.text());
              setRows(data);
              setHeaders(data[0]);
              setMapping({
                title: data[0].includes("title") ? "title" : "",
                url: data[0].includes("url") ? "url" : "",
                description: data[0].includes("description")
                  ? "description"
                  : "",
                tags: data[0].includes("tags") ? "tags" : "",
              });
              setMessage("");
            } catch (error) {
              setHeaders([]);
              setRows([]);
              setMessage(
                error instanceof Error
                  ? error.message
                  : "Couldn't read this CSV.",
              );
            }
          }}
        />
      </Field>
      {headers.length
        ? Object.entries(mapping).map(([key, value]) => (
            <Field
              label={`${key.charAt(0).toUpperCase() + key.slice(1)} column`}
              key={key}
              required={key === "title" || key === "url"}
            >
              <Dropdown
                value={value}
                onChange={(e) =>
                  setMapping({ ...mapping, [key]: e.target.value })
                }
              >
                <option value="">Choose a column</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Dropdown>
            </Field>
          ))
        : null}
      {preview.length ? (
        <div className="rounded-md border border-line p-3">
          <p className="text-label">
            {preview.length} records · {preview.filter((r) => r.error).length}{" "}
            errors
          </p>
          <ul className="text-caption">
            {preview.slice(0, 5).map((r) => (
              <li className="break-words py-1" key={r.row}>
                Row {r.row}: {r.error ?? r.data?.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Field label="Import mode">
        <Dropdown name="dryRun" defaultValue="true">
          <option value="true">Preview only: do not create links</option>
          <option value="false">Import valid CSV</option>
        </Dropdown>
      </Field>
      <p className="text-caption text-ink-muted">
        If any row is invalid, no links are created. Tags use semicolons inside
        a cell.
      </p>
      <Button type="submit" disabled={!preview.length} loading={pending}>
        Queue import
      </Button>
      <p role="status">{message}</p>
    </form>
  );
}
