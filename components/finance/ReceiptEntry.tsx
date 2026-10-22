"use client";
import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { extractReceiptAction } from "@/app/actions/finance-tools";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Callout } from "@/components/ui/display";
import { FinanceAttachments, type FinanceFile } from "./FinanceAttachments";
import { ToolForm, type FormField } from "./ToolForm";
import { currencyField, options, tagFields, taxFields } from "./ToolFields";
import { INCOME_SOURCES } from "@/lib/finance/tools-rules";
import type { FinancePickers } from "@/lib/finance/tools/queries";
import type { ExtractedReceipt } from "@/lib/finance/tools/extract";

const subscribe = () => () => {};
export function ReceiptEntry({
  slug,
  pickers,
  currency,
  today,
  configured,
}: {
  slug: string;
  pickers: FinancePickers;
  currency: string;
  today: string;
  configured: boolean;
}) {
  const [files, setFiles] = useState<FinanceFile[]>([]),
    [busy, setBusy] = useState(false),
    [data, setData] = useState<ExtractedReceipt | null>(
      null,
    ),
    [error, setError] = useState(""),
    [pending, start] = useTransition(),
    [revision, setRevision] = useState(0);
  const router = useRouter();
  const raw = useSyncExternalStore(
    subscribe,
    () => {
      try {
        return sessionStorage.getItem(`sww:finance-defaults:${slug}`) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );
  let defaults: Record<string, string> = {};
  try {
    defaults = JSON.parse(raw || "{}");
  } catch {}
  const fields: FormField[] = [
    {
      name: "kind",
      label: "Entry type",
      type: "select",
      options: options(["INCOME", "EXPENSE"]),
      value: defaults.kind ?? "EXPENSE",
      required: true,
    },
    currencyField(defaults.currency ?? currency),
    {
      name: "occurredOn",
      label: "Date",
      type: "date",
      value: data?.date ?? today,
      required: true,
    },
    {
      name: "amountMinor",
      label: "Total amount",
      type: "money",
      value: data?.total ?? "",
      required: true,
    },
    {
      name: "description",
      label: "Description",
      value: data?.vendor ? `Receipt from ${data.vendor}` : "",
      required: true,
      maxLength: 120,
    },
    {
      name: "counterparty",
      label: "Vendor, donor or funder",
      value: data?.vendor ?? "",
      maxLength: 120,
    },
    {
      name: "invoiceNumber",
      label: "Invoice or receipt number",
      value: data?.invoiceNumber ?? "",
      maxLength: 120,
    },
    {
      name: "incomeSource",
      label: "Income source",
      type: "select",
      options: options(INCOME_SOURCES),
      value: defaults.incomeSource ?? "OTHER",
    },
    ...tagFields(pickers, defaults),
    {
      name: "budgetId",
      label: "Budget",
      type: "select",
      options: pickers.budgets,
    },
    ...taxFields(
      data
        ? {
            gstin: data.gstin,
            taxableMinor: data.taxableValue,
            cgstMinor: data.cgst,
            sgstMinor: data.sgst,
            igstMinor: data.igst,
          }
        : {},
    ),
    ...files.map((f) => ({
      name: "fileIds",
      label: "File",
      type: "hidden" as const,
      value: f.id,
    })),
  ];
  const suggested = data?.suggestedCategory
    ? pickers.categories.find(
        (c) => c.name.toLowerCase() === data.suggestedCategory!.toLowerCase(),
      )
    : null;
  if (suggested) {
    const category = fields.find((f) => f.name === "categoryId");
    if (category) category.value = suggested.id;
  }
  return (
    <div className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <Card>
        <CardHeader
          title="Start with a receipt"
          description="Upload a bill, take a photo, or enter the details manually."
        />
        <FinanceAttachments
          slug={slug}
          type="STAGED"
          onChange={setFiles}
          onBusyChange={setBusy}
        />
        {configured ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-caption text-ink-muted">
              Extract sends the first receipt to your configured Space Works
              Assistant. Review every field before saving.
            </p>
            <Button
              variant="secondary"
              disabled={!files.length}
              loading={pending}
              onClick={() =>
                start(async () => {
                  setError("");
                  try {
                    const r = await extractReceiptAction(slug, files[0]!.id);
                    if (!r.ok) {
                      setError(r.error);
                      return;
                    }
                    if (!r.data.configured) {
                      setError(
                        "The assistant is not configured. Enter the details manually.",
                      );
                      return;
                    }
                    setData(r.data.fields);
                    setRevision((n) => n + 1);
                  } catch {
                    setError(
                      "Couldn't extract the receipt. Enter the details manually.",
                    );
                  }
                })
              }
            >
              Extract receipt details
            </Button>
          </div>
        ) : (
          <p className="mt-4 text-body-ui text-ink-muted">
            Enter the receipt details below. The assistant is not configured.
          </p>
        )}
        {error ? (
          <div className="mt-4">
            <Callout tone="warning" role="alert">
              {error}
            </Callout>
          </div>
        ) : null}
        {data ? (
          <p className="mt-4 text-body-ui text-ink-muted">
            Suggested category: {data.suggestedCategory ?? "Not identified"}.
            Check the date, currency and amounts.
          </p>
        ) : null}
      </Card>
      <Card>
        <CardHeader
          title="Review and save"
          description="Your usual category, fund and account are remembered in this tab."
        />
        <ToolForm
          key={`${raw}:${revision}`}
          slug={slug}
          operation="entry"
          fields={fields}
          button="Confirm and save entry"
          remember
          disabled={busy || pending}
          onSaved={() => router.push(`/w/${slug}/finance/ledger`)}
        />
      </Card>
    </div>
  );
}
