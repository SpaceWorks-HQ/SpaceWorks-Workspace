import type { FormField } from "./ToolForm";
import type { FinancePickers } from "@/lib/finance/tools/queries";
import { label } from "@/lib/finance/tools-rules";
export const options = (values: readonly string[]) =>
  values.map((id) => ({ id, name: label(id) }));
export const hidden = (name: string, value: string): FormField => ({
  name,
  label: name,
  type: "hidden",
  value,
});
export const money = (
  name: string,
  labelText: string,
  value = "0",
  required = false,
): FormField => ({ name, label: labelText, type: "money", value, required });
export function tagFields(
  p: FinancePickers,
  v: Record<string, unknown> = {},
): FormField[] {
  return [
    {
      name: "fundId",
      label: "Fund",
      type: "select",
      options: p.funds.map((f) => ({
        id: f.id,
        name: `${f.name} (${f.currency})`,
      })),
      value: String(v.fundId ?? ""),
    },
    {
      name: "costCentreId",
      label: "Event, programme, project or team",
      type: "select",
      options: p.centres,
      value: String(v.costCentreId ?? ""),
    },
    {
      name: "accountId",
      label: "Bank or cash account",
      type: "select",
      options: p.accounts.map((a) => ({
        id: a.id,
        name: `${a.name} (${a.currency})`,
      })),
      value: String(v.accountId ?? ""),
    },
    {
      name: "categoryId",
      label: "Category",
      type: "select",
      options: p.categories.map((c) => ({
        id: c.id,
        name: `${c.name} (${label(c.kind)})`,
      })),
      value: String(v.categoryId ?? ""),
    },
    {
      name: "purpose",
      label: "Source or purpose",
      value: String(v.purpose ?? ""),
      maxLength: 200,
    },
  ];
}
export const currencyField = (currency: string): FormField => ({
  name: "currency",
  label: "Currency",
  value: currency,
  required: true,
  maxLength: 3,
  helper: "Three-letter code, for example INR.",
});
export const taxFields = (v: Record<string, unknown> = {}): FormField[] => [
  {
    name: "gstin",
    label: "Supplier GSTIN or tax ID",
    value: String(v.gstin ?? ""),
    maxLength: 30,
  },
  ...[
    ["taxableMinor", "Taxable value"],
    ["cgstMinor", "CGST"],
    ["sgstMinor", "SGST"],
    ["igstMinor", "IGST"],
    ["tdsMinor", "TDS withheld"],
  ].map(([name, labelText]) =>
    money(name!, labelText!, String(v[name!] ?? "0")),
  ),
];
