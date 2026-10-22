import type { PayrollView } from "@/lib/finance/tools/views";
import type { FormField } from "./ToolForm";
import { currencyField, hidden, money, options, tagFields } from "./ToolFields";
import { minorToDecimalString } from "@/lib/finance/money";

export function payrollFields(
  payroll: NonNullable<PayrollView["payroll"]>,
  currency: string,
) {
  const { data, pickers: p } = payroll;
  const profileFields = (v?: (typeof data.profiles)[number]): FormField[] => [
    ...(v ? [hidden("id", v.id)] : []),
    { name: "name", label: "Person's name", required: true, value: v?.name },
    {
      name: "userId",
      label: "Workspace member",
      type: "select",
      options: p.members,
      value: v?.userId ?? "",
    },
    {
      name: "kind",
      label: "Engagement",
      type: "select",
      options: options(["STAFF", "CONSULTANT", "VOLUNTEER", "INTERN"]),
      value: v?.kind ?? "STAFF",
      required: true,
    },
    currencyField(v?.currency ?? currency),
    money(
      "rateMinor",
      "Monthly amount or rate",
      v ? minorToDecimalString(v.rateMinor, v.currency) : "",
      true,
    ),
    {
      name: "rateBasis",
      label: "Rate basis",
      type: "select",
      options: options(["MONTH", "DAY", "HOUR", "ASSIGNMENT"]),
      value: v?.rateBasis ?? "MONTH",
      required: true,
    },
    {
      name: "pan",
      label: "PAN",
      helper: v
        ? "Leave blank to keep the existing PAN."
        : "Optional. Stored privately.",
    },
    {
      name: "bankLast4",
      label: "Bank account last four digits",
      maxLength: 4,
      helper: "Only four digits are accepted.",
    },
    { name: "ifsc", label: "IFSC", maxLength: 11 },
    {
      name: "tdsSection",
      label: "TDS section",
      value: v?.tdsSection ?? "",
      helper:
        "For example 192, 194J or 194C; use a local tax reference outside India.",
    },
    {
      name: "costCentreId",
      label: "Default cost centre",
      type: "select",
      options: p.centres,
      value: v?.costCentreId ?? "",
    },
    ...[
      ["pfApplicable", "Provident fund applies"],
      ["esiApplicable", "ESI applies"],
      ["ptApplicable", "Professional tax applies"],
    ].map(([name, text]) => ({
      name: name!,
      label: text!,
      type: "checkbox" as const,
      value: !!v?.[name as "pfApplicable" | "esiApplicable" | "ptApplicable"],
    })),
    ...(v
      ? [
          {
            name: "clearPan",
            label: "Clear the stored PAN",
            type: "checkbox" as const,
          },
          {
            name: "clearBank",
            label: "Clear the stored bank reference",
            type: "checkbox" as const,
          },
          {
            name: "archived",
            label: "Archive this pay profile",
            type: "checkbox" as const,
            value: !!v.archivedAt,
          },
        ]
      : []),
  ];
  const payFields = (
    profile: (typeof data.profiles)[number],
    r?: (typeof data.runs)[number],
  ): FormField[] => [
    ...(r ? [hidden("id", r.id)] : []),
    hidden("profileId", profile.id),
    {
      name: "month",
      label: "Pay month",
      type: "month",
      value: r?.month ?? data.period.month,
      required: true,
      min: "2000-01",
      max: "2099-12",
    },
    ...[
      ["grossMinor", "Gross pay"],
      ["allowancesMinor", "Allowances"],
      ["pfMinor", "PF deduction"],
      ["esiMinor", "ESI deduction"],
      ["ptMinor", "Professional tax deduction"],
      ["tdsMinor", "TDS deduction"],
      ["advancesMinor", "Advances recovered"],
      ["otherMinor", "Other deductions"],
    ].map(([name, text]) =>
      money(
        name!,
        text!,
        r
          ? minorToDecimalString(
              r[name as "grossMinor" | "allowancesMinor"],
              r.currency,
            )
          : name === "grossMinor" && profile.rateBasis === "MONTH"
            ? minorToDecimalString(profile.rateMinor, profile.currency)
            : "0",
        true,
      ),
    ),
    ...tagFields(p, r ?? { costCentreId: profile.costCentreId }).filter(
      (f) => f.name !== "purpose",
    ),
    { name: "notes", label: "Notes", type: "textarea", value: r?.notes ?? "" },
  ];
  return { profileFields, payFields };
}
