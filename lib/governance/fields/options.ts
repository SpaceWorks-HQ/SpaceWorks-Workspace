import { label } from "../schemas";
import type { Choice } from "../fields";

export const opts = (values: string[]) =>
  values.map((value) => ({ value, label: label(value) }));
export const optional = (values: Choice[]) => [
  { value: "", label: "None" },
  ...values,
];
