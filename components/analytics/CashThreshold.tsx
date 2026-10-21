"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import type { AnalyticsQuery } from "@/lib/analytics/types";
import { queryString, parseCashAmount } from "@/lib/analytics/metrics";
import { currencyMinorDigits } from "@/lib/format/money";

export function CashThreshold({
  slug,
  q,
  currency,
  value,
}: {
  slug: string;
  q: AnalyticsQuery;
  currency: string;
  value: number;
}) {
  const router = useRouter(),
    [error, setError] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-3 print:hidden"
      action={(form) => {
        const amount = parseCashAmount(
          String(form.get("amount") ?? ""),
          currency,
        );
        if (amount === null || amount < 0 || amount > 999999999999) {
          setError("Enter a cash threshold within the supported range.");
          return;
        }
        setError("");
        router.push(
          `/w/${slug}/analytics?${queryString({ ...q, threshold: String(amount) })}`,
        );
      }}
    >
      <Field label={`Low cash threshold in ${currency}`}>
        <Input
          name="amount"
          type="number"
          min="0"
          max={999999999999 / 10 ** currencyMinorDigits(currency)}
          step={10 ** -currencyMinorDigits(currency)}
          defaultValue={value / 10 ** currencyMinorDigits(currency)}
          required
        />
      </Field>
      <Button type="submit" variant="secondary">
        Update threshold
      </Button>
      <p role="status" className="text-body-sm text-danger-fg">
        {error}
      </p>
    </form>
  );
}
