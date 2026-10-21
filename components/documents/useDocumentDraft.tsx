"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { documentAction } from "@/app/actions/documents";
import {
  LETTERS,
  GST_TYPES,
  calculate,
  parseDocumentAmount,
  type DraftInput,
  type DocumentLine,
} from "@/lib/documents/rules";
import type { EditorOptions } from "@/lib/documents/types";
import { DocumentFields, type DocumentField } from "./DocumentForm";
import { formatMoney } from "@/lib/format/money";

export const baseLine: DocumentLine = {
  description: "",
  quantity: "1",
  unitMinor: 0,
  discountMinor: 0,
  hsn: "",
  unit: "NOS",
  rateBps: 0,
  cessBps: 0,
  exempt: false,
  exemption: "",
  ruleId: "",
};
export function useDocumentDraft(slug: string, initial: DraftInput, options: EditorOptions) {
  const [type, setType] = useState(initial.type),
    [gstAdjustment, setGstAdjustment] = useState(initial.gstAdjustment),
    [currency, setCurrency] = useState(initial.currency),
    [sourceType, setSourceType] = useState(initial.sourceType),
    [lines, setLines] = useState<DocumentLine[]>(
      initial.lines.length ? initial.lines : [{ ...baseLine }],
    ),
    [message, setMessage] = useState(""),
    [errors, setErrors] = useState<Record<string, string[]>>({}),
    [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null),
    errorRef = useRef<HTMLParagraphElement>(null),
    router = useRouter();
  const refs = (kind: string) =>
    options.references
      .filter((r) => r.kind === kind)
      .map((r) => ({ id: r.id, name: r.name }));
  const isLetter = LETTERS.includes(type),
    gst =
      GST_TYPES.includes(type) &&
      (!["CREDIT_NOTE", "DEBIT_NOTE"].includes(type) || gstAdjustment),
    donation = type.startsWith("DONATION"),
    uc = type.endsWith("_UC"),
    receipt =
      type === "US_ACKNOWLEDGEMENT" ||
      type.includes("RECEIPT") ||
      type === "PAYMENT_REFUND" ||
      type.includes("VOUCHER") ||
      donation;
  const f = (
    name: keyof DraftInput,
    title: string,
    kind?: DocumentField["type"],
    helper?: string,
  ): DocumentField => ({
    name,
    label: title,
    type: kind,
    value: initial[name] as string | number | boolean,
    helper,
  });
  const section = (title: string, fields: DocumentField[]) => (
    <fieldset className="space-y-4 rounded-xl border border-line bg-panel p-4 sm:p-6">
      <legend className="px-2 text-title">{title}</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        <DocumentFields fields={fields} errors={errors} />
      </div>
    </fieldset>
  );
  const updateLine = (i: number, change: Partial<DocumentLine>) =>
    setLines(lines.map((l, n) => (n === i ? { ...l, ...change } : l)));
  const sourceOptions =
    sourceType === "INVOICE"
      ? options.invoices
      : sourceType === "LEDGER"
        ? options.ledger
        : sourceType === "FUND"
          ? options.funds
          : sourceType === "FUNDING"
            ? options.funding
            : sourceType === "CONTRACT"
              ? options.contracts
              : [];
  let preview = "Add lines to preview the total.";
  try {
    preview = `Preview before tax review: ${formatMoney(calculate(lines, "NONE").totalMinor, currency)}`;
  } catch {
    /* Fields may be incomplete while typing. */
  }
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const raw: Record<string, unknown> = {
      ...initial,
      ...Object.fromEntries(form),
      type,
      currency,
      sourceType,
      lines: isLetter || uc ? [] : lines,
      gstAdjustment,
  };
  for (const key of [
    "cashMinor",
    "tdsMinor",
    "inrMinor",
    "openingMinor",
    "receiptsMinor",
    "interestMinor",
    "expenditureMinor",
    "refundsMinor",
    "advancesMinor",
    "benefitValueMinor",
    "vatSterlingMinor",
  ]) {
    const value = form.get(key);
    if (value !== null) {
      const n = parseDocumentAmount(
        String(value),
        key === "vatSterlingMinor"
          ? "GBP"
          : key === "inrMinor"
            ? "INR"
            : currency,
      );
      if (n === null) {
        setMessage(
          "Enter money using decimal amounts, for example 1250.50.",
        );
        return;
      }
      raw[key] = n;
    }
  }
  for (const key of [
    "reviewed",
    "roundRupee",
    "reverseCharge",
    "fcraAccount",
    "irnRequired",
  ])
    raw[key] = form.get(key) === "on";
  form.set("payload", JSON.stringify(raw));
  start(async () => {
    const r = await documentAction(slug, "draft", form);
    if (r.ok && r.data) {
      router.push(`/w/${slug}/documents/${r.data.id}`);
      router.refresh();
    } else if (!r.ok) {
      setMessage(r.error);
      setErrors(r.fieldErrors ?? {});
      errorRef.current?.focus();
    }
  });
  };
  return {
    initial,
    options,
    type,
    setType,
    gstAdjustment,
    setGstAdjustment,
    currency,
    setCurrency,
    sourceType,
    setSourceType,
    lines,
    setLines,
    message,
    errors,
    pending,
    formRef,
    errorRef,
    refs,
    isLetter,
    gst,
    donation,
    uc,
    receipt,
    f,
    section,
    updateLine,
    sourceOptions,
    preview,
    onSubmit,
  };
}

export type DocumentDraft = ReturnType<typeof useDocumentDraft>;
