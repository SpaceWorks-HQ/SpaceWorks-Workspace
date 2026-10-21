import type { FormField } from "@/components/finance/ToolForm";
import type { EditableControl } from "@/lib/moneyControls/rules";
import { currencyMinorDigits } from "@/lib/format/money";

export function applyControlFieldValues(
  fields: FormField[],
  currency: string,
  today: string,
  row?: EditableControl,
) {
  const d = (row?.details ?? {}) as Record<string, unknown>,
    money = (n: number) =>
      (n / 10 ** currencyMinorDigits(row?.currency ?? currency)).toFixed(
        currencyMinorDigits(row?.currency ?? currency),
      );
  for (const f of fields) {
    const key = f.name.replace(/^detail\./, ""),
      value = f.name.startsWith("detail.") ? d[key] : row?.[key];
    if (value !== undefined && value !== null)
      f.value =
        f.type === "money"
          ? money(Number(value))
          : f.type === "checkbox"
            ? Boolean(value)
            : String(value);
    else if (f.name === "detail.refundable") f.value = "YES";
    else if (f.name === "reminderDays") f.value = "7";
    else if (f.name === "detail.fiscalYear")
      f.value = String(
        new Date(today).getUTCFullYear() -
          (new Date(today).getUTCMonth() < 3 ? 1 : 0),
      );
    else if (f.name === "detail.lifeYears") f.value = "5";
    else if (f.name === "detail.ratePercent")
      f.value = String(Number(d.rateBps ?? 2000) / 100);
    else if (f.name === "detail.residualMinor") f.value = "0";
    else if (f.name.endsWith("Mode")) f.value = "BLOCK";
  }
}
