"use client";
import { useState } from "react";
import { ToolForm, type FormField } from "./ToolForm";
import { FinanceAttachments, type FinanceFile } from "./FinanceAttachments";
import type { ToolOperation } from "@/lib/finance/tools-rules";
export function MoneyRecordForm({
  slug,
  operation,
  fields,
  button,
}: {
  slug: string;
  operation: ToolOperation;
  fields: FormField[];
  button: string;
}) {
  const [files, setFiles] = useState<FinanceFile[]>([]),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  return (
    <div key={revision} className="flex flex-col gap-4">
      {saved ? (
        <p role="status" className="text-success-fg">
          Saved. Add another if needed.
        </p>
      ) : null}
      <FinanceAttachments
        slug={slug}
        type="STAGED"
        onChange={setFiles}
        onBusyChange={setBusy}
      />
      <ToolForm
        slug={slug}
        operation={operation}
        fields={[
          ...fields,
          ...files.map((f) => ({
            name: "fileIds",
            label: "File",
            type: "hidden" as const,
            value: f.id,
          })),
        ]}
        button={button}
        disabled={busy}
        onSaved={() => {
          setSaved(true);
          setFiles([]);
          setRevision((n) => n + 1);
        }}
      />
    </div>
  );
}
