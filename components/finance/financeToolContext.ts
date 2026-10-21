import type { FormField } from "./ToolForm";
import { currencyField, hidden, money, tagFields, taxFields } from "./ToolFields";
import { isoDay, localDate } from "@/lib/finance/dates";
import { minorToDecimalString } from "@/lib/finance/money";
import type { FinanceToolView } from "@/lib/finance/tools/views";
import type { FinanceActor } from "@/lib/finance/tools/access";

export function financeToolContext(actor: FinanceActor, view: FinanceToolView) {
  const { data, pickers: p, files } = view;
  const slug = actor.workspace.slug,
    base = `/w/${slug}/finance`,
    today = localDate(new Date(), actor.workspace.timezone),
    currency = actor.workspace.currency;
  const manage = data.manage;
  const selectMember = (value: string | null = ""): FormField => ({
    name: "ownerId",
    label: "Owner",
    type: "select",
    options: p.members,
    value: value ?? "",
  });
  const fundFields = (f?: (typeof data.funds)[number]): FormField[] => [
    ...(f ? [hidden("id", f.id)] : []),
    {
      name: "name",
      label: "Fund name",
      value: f?.name,
      required: true,
      maxLength: 120,
    },
    currencyField(f?.currency ?? currency),
    {
      name: "restricted",
      label: "Restricted to a donor's purpose",
      type: "checkbox",
      value: f?.restricted,
    },
    { name: "funder", label: "Donor or funder", value: f?.funder ?? "" },
    { name: "notes", label: "Notes", type: "textarea", value: f?.notes ?? "" },
    ...(f
      ? [
          {
            name: "archived",
            label: "Archive this fund",
            type: "checkbox" as const,
            value: !!f.archivedAt,
          },
        ]
      : []),
  ];
  const budgetFields = (b?: (typeof data.budgets)[number]): FormField[] => [
    ...(b ? [hidden("id", b.id)] : []),
    { name: "name", label: "Budget line", required: true, value: b?.name },
    currencyField(b?.currency ?? currency),
    money(
      "amountMinor",
      "Budget amount",
      b ? minorToDecimalString(b.amountMinor, b.currency) : "",
      true,
    ),
    {
      name: "periodStart",
      label: "Period starts",
      type: "date",
      required: true,
      value: b ? isoDay(b.periodStart) : data.period.from,
    },
    {
      name: "periodEnd",
      label: "Period ends",
      type: "date",
      required: true,
      value: b ? isoDay(b.periodEnd) : data.period.to,
    },
    {
      name: "categoryId",
      label: "Expense category",
      type: "select",
      options: p.categories.filter((c) => c.kind === "EXPENSE"),
      value: b?.categories[0] ?? "",
    },
    {
      name: "costCentreId",
      label: "Cost centre",
      type: "select",
      options: p.centres,
      value: b?.costCentreId ?? "",
    },
    {
      name: "varianceNote",
      label: "Variance note",
      type: "textarea",
      value: b?.varianceNote ?? "",
      helper: "Explain a planned overspend or change in activity.",
    },
  ];
  const billFields = (b?: (typeof data.bills)[number]): FormField[] => [
    ...(b ? [hidden("id", b.id)] : []),
    { name: "vendor", label: "Vendor", required: true, value: b?.vendor },
    { name: "number", label: "Bill number", required: true, value: b?.number },
    {
      name: "issuedOn",
      label: "Bill date",
      type: "date",
      value: b ? isoDay(b.issuedOn) : today,
      required: true,
    },
    {
      name: "dueOn",
      label: "Due date",
      type: "date",
      value: b ? isoDay(b.dueOn) : today,
      required: true,
    },
    currencyField(b?.currency ?? currency),
    money(
      "amountMinor",
      "Amount payable after TDS",
      b ? minorToDecimalString(b.amountMinor, b.currency) : "",
      true,
    ),
    ...tagFields(p, b ?? {}),
    ...taxFields(
      b
        ? Object.fromEntries(
            Object.entries(b).map(([k, v]) => [
              k,
              k.endsWith("Minor") && typeof v === "number"
                ? minorToDecimalString(v, b.currency)
                : v,
            ]),
          )
        : {},
    ),
    selectMember(b?.ownerId),
    { name: "notes", label: "Notes", type: "textarea", value: b?.notes ?? "" },
  ];
  return {
    data,
    p,
    files,
    slug,
    base,
    today,
    currency,
    manage,
    selectMember,
    fundFields,
    budgetFields,
    billFields,
  };
}

export type FinanceToolContext = ReturnType<typeof financeToolContext>;
