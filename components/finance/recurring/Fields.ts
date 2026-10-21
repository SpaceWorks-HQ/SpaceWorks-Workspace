import { formatDay } from "@/lib/finance/dates";
import { label } from "@/lib/finance/tools-rules";
import type { FormField } from "@/components/finance/ToolForm";

export const pretty = (v: Date | string | null | undefined) =>
  v ? formatDay(typeof v === "string" ? new Date(v) : v) : "—";
export const date = (v: Date | null | undefined) =>
  v?.toISOString().slice(0, 10) ?? "";
export const hidden = (name: string, value: string): FormField => ({
  name,
  label: name,
  type: "hidden",
  value,
});
export const select = (
  name: string,
  label: string,
  options: { id: string; name: string }[],
  value = "",
  required = false,
): FormField => ({ name, label, type: "select", options, value, required });
export const text = (
  name: string,
  label: string,
  value = "",
  type: FormField["type"] = "text",
  required = false,
): FormField => ({ name, label, value, type, required });
export const opts = (values: readonly string[]) =>
  values.map((id) => ({ id, name: label(id) }));
