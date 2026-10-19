"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { commitLedgerImportAction, previewLedgerImportAction } from "@/app/actions/finance";
import { useToast } from "@/components/feedback/ToastProvider";
import { Button } from "@/components/ui/button";
import { Callout, Card, CardHeader } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LEDGER_CSV_COLUMNS, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, type ImportPreview } from "@/lib/finance/csv";
import { formatMoney } from "@/lib/format/money";

/** Pick a CSV → server preview (every row validated) → import only when nothing is wrong. */
export function ImportLedger({ slug, currency, ledgerHref }: { slug: string; currency: string; ledgerHref: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const pick = async (file: File | undefined) => {
    setPreview(null);
    setError(null);
    setCsv(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      setError("That file is too large. Import at most 1 MB at a time.");
      return;
    }
    const text = await file.text();
    setFileName(file.name);
    setCsv(text);
    startTransition(async () => {
      const result = await previewLedgerImportAction(slug, text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.data ?? null);
    });
  };

  const commit = () =>
    startTransition(async () => {
      if (!csv) return;
      const result = await commitLedgerImportAction(slug, csv);
      if (!result.ok) {
        showToast(result.error, "error");
        return;
      }
      showToast(`Imported ${result.data?.count ?? 0} entries.`, "success");
      router.push(ledgerHref);
      router.refresh();
    });

  const ready = preview?.ok && preview.problems.length === 0 && preview.rows.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <Card padding="lg">
        <CardHeader title="Choose a CSV file" description={`Columns: ${LEDGER_CSV_COLUMNS.join(", ")}. Amounts are positive numbers in ${currency}; kind is income or expense. Up to ${MAX_IMPORT_ROWS} rows.`} />
        <Field label="CSV file" helperText="Export the ledger first to get a file in the right shape." error={error ?? undefined}>
          <Input type="file" accept=".csv,text/csv" className="py-2" onChange={(event) => void pick(event.target.files?.[0])} disabled={pending} />
        </Field>
      </Card>

      {preview?.ok ? (
        <>
          {preview.problems.length ? (
            <Callout tone="danger" title={`${preview.problems.length} ${preview.problems.length === 1 ? "row needs" : "rows need"} fixing before anything is imported.`}>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {preview.problems.slice(0, 50).map((problem) => (
                  <li key={problem.line}>
                    Line {problem.line}: {problem.message}.
                  </li>
                ))}
              </ul>
              {preview.problems.length > 50 ? <p className="mt-2">And {preview.problems.length - 50} more.</p> : null}
            </Callout>
          ) : (
            <Callout tone="success" title={`${preview.rows.length} ${preview.rows.length === 1 ? "entry is" : "entries are"} ready to import from ${fileName}.`}>
              Check the preview, then import. Nothing changes until you do.
            </Callout>
          )}
          {preview.rows.length ? (
            <Table label="Import preview">
              <THead>
                <TR>
                  <TH>Line</TH>
                  <TH>Date</TH>
                  <TH>Description</TH>
                  <TH>Category</TH>
                  <TH className="text-right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {preview.rows.slice(0, 200).map((row) => (
                  <TR key={row.line}>
                    <TD className="tabular-nums text-ink-muted">{row.line}</TD>
                    <TD className="whitespace-nowrap tabular-nums">{row.occurredOn}</TD>
                    <TD>
                      {row.description}
                      {row.counterparty ? <span className="block text-caption text-ink-muted">{row.counterparty}</span> : null}
                    </TD>
                    <TD className="text-ink-secondary">{row.categoryName ?? "—"}</TD>
                    <TD className="whitespace-nowrap text-right font-semibold tabular-nums">
                      {row.kind === "INCOME" ? "+" : "−"}
                      {formatMoney(row.amountMinor, row.currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : null}
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => router.push(ledgerHref)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={commit} disabled={!ready} loading={pending && Boolean(ready)}>
              Import {preview.rows.length} {preview.rows.length === 1 ? "entry" : "entries"}
            </Button>
          </div>
        </>
      ) : preview && !preview.ok ? (
        <Callout tone="danger" title="That file can't be imported.">
          {preview.error}
        </Callout>
      ) : null}
    </div>
  );
}
