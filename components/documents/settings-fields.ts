import type { DocumentField } from "@/components/documents/DocumentForm";

export const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const text = (name: string, title: string, value?: string): DocumentField => ({
  name,
  label: title,
  value,
});
export const dates: DocumentField[] = [
  { name: "validFrom", label: "Valid from", type: "date", required: true },
  { name: "validTo", label: "Valid to", type: "date", required: true },
];
