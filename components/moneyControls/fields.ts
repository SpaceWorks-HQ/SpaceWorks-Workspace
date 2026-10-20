import type { FormField } from "@/components/finance/ToolForm";
import type { Kind, EditableControl } from "@/lib/moneyControls/rules";
import { currencyMinorDigits } from "@/lib/format/money";
import type { ControlPickers } from "@/lib/moneyControls/types";
export type Pickers = ControlPickers;
export type EditableRecord = EditableControl;
const enumOptions = (v: string[]) =>
  v.map((id) => ({ id, name: id.replaceAll("_", " ") }));
export function controlFields(
  kind: Kind,
  p: Pickers,
  currency: string,
  today: string,
  row?: EditableRecord,
): FormField[] {
  const d = (row?.details ?? {}) as Record<string, unknown>,
    money = (n: number) =>
      (n / 10 ** currencyMinorDigits(row?.currency ?? currency)).toFixed(
        currencyMinorDigits(row?.currency ?? currency),
      );
  const fields: FormField[] = [
    { name: "title", label: "Title", required: true },
    {
      name: "occurredOn",
      label:
        kind === "FUND_RULE"
          ? "Eligible from"
          : kind === "SCHEDULE"
            ? "Purchase date"
            : "Record date",
      type: "date",
      required: true,
      value: today,
    },
    {
      name: "currency",
      label: "Currency",
      required: true,
      value: currency,
      maxLength: 3,
    },
  ];
  const add = (
    name: string,
    label: string,
    options?: { id: string; name: string }[],
    required = false,
    type: FormField["type"] = "text",
    helper?: string,
  ) =>
    fields.push({
      name,
      label,
      type: options ? "select" : type,
      options,
      required,
      helper,
    });
  const amountKinds = [
    "FLOAT",
    "VOUCHER",
    "REPLENISHMENT",
    "HANDOVER",
    "DEPOSIT",
    "TRANSFER",
    "SCHEDULE",
    "DISPOSAL",
    "TDS_DEDUCTION",
    "CERTIFICATE",
    "FILING",
    "FUND_RULE",
  ];
  if (amountKinds.includes(kind))
    add(
      "amountMinor",
      kind === "FLOAT"
        ? "Target float"
        : kind === "FUND_RULE"
          ? "Eligible budget"
          : kind === "DISPOSAL"
            ? "Sale proceeds"
            : kind === "TDS_DEDUCTION" || kind === "CERTIFICATE"
              ? "TDS amount"
              : kind === "SCHEDULE"
                ? "Purchase cost"
                : "Amount",
      undefined,
      true,
      "money",
    );
  if (
    [
      "FLOAT",
      "VOUCHER",
      "COUNT",
      "REPLENISHMENT",
      "HANDOVER",
      "DEPOSIT",
      "TRANSFER",
      "DISPOSAL",
    ].includes(kind)
  )
    add(
      "accountId",
      kind === "TRANSFER" ? "From account" : "Account",
      p.accounts.map((a) => ({ id: a.id, name: `${a.name} (${a.currency})` })),
      kind !== "DISPOSAL",
    );
  if (["TRANSFER", "REPLENISHMENT"].includes(kind))
    add(
      "otherAccountId",
      kind === "TRANSFER" ? "To account" : "Replenish from",
      p.accounts,
      true,
    );
  if (["VOUCHER", "SCHEDULE", "FUND_RULE"].includes(kind))
    add("fundId", "Fund or grant", p.funds, kind === "FUND_RULE");
  if (kind === "VOUCHER") {
    add("categoryId", "Expense category", p.categories);
    add("detail.payee", "Payee");
  }
  if (["SCHEDULE", "VERIFICATION", "DISPOSAL", "ASSIGNMENT"].includes(kind))
    add("assetId", "Equipment", p.assets, true);
  add(
    "ownerId",
    kind === "HANDOVER"
      ? "Incoming custodian"
      : kind === "FLOAT"
        ? "Custodian"
        : kind === "ASSIGNMENT"
          ? "Assigned person"
          : "Owner",
    p.members,
    ["FLOAT", "HANDOVER", "ASSIGNMENT"].includes(kind),
  );
  if (kind === "COUNT")
    add(
      "detail.denominations",
      "Denominations and quantities",
      undefined,
      true,
      "textarea",
      "Enter major units and counts, like 500=2, 100=3, 10=4. The saved count retains its expected balance and difference.",
    );
  if (kind === "DEPOSIT") {
    add(
      "detail.direction",
      "Direction",
      enumOptions(["GIVEN", "RECEIVED"]),
      true,
    );
    add("detail.counterparty", "Counterparty", undefined, true);
  }
  if (kind === "ASSET_CATEGORY") {
    add("detail.method", "Method", enumOptions(["SLM", "WDV"]), true);
    add("detail.lifeYears", "Useful life in years", undefined, true);
    add(
      "detail.ratePercent",
      "WDV annual rate (%)",
      undefined,
      true,
      "text",
      "For 20%, enter 20. Used for WDV; SLM uses useful life.",
    );
    add("detail.residualMinor", "Residual value", undefined, false, "money");
    add(
      "detail.taxBlockNote",
      "Income-tax block / rate note",
      undefined,
      false,
      "textarea",
      "Keep accountant-reviewed block rates and effective dates here. The book schedule uses daily proration; tax blocks are separate.",
    );
  }
  if (kind === "SCHEDULE") {
    add(
      "detail.categoryRecordId",
      "Depreciation category",
      p.records
        .filter((r) => r.kind === "ASSET_CATEGORY")
        .map((r) => ({ id: r.id, name: r.title })),
      true,
    );
    add("detail.fundingSource", "Funding source / grant reference");
  }
  if (["VERIFICATION", "ASSIGNMENT"].includes(kind))
    add("detail.condition", "Condition", undefined, true);
  if (kind === "DISPOSAL") {
    add(
      "detail.method",
      "Disposal method",
      enumOptions(["SALE", "SCRAP", "DONATION"]),
      true,
    );
    add("detail.counterparty", "Buyer or recipient");
  }
  if (kind === "ASSIGNMENT")
    add(
      "checklistRunId",
      "Onboarding / offboarding checklist",
      p.checklists.map((r) => ({ id: r.id, name: r.title })),
    );
  if (["TDS_DEDUCTION", "CERTIFICATE", "FILING"].includes(kind)) {
    if (kind !== "FILING") {
      add("detail.payee", "Payee", undefined, true);
      add(
        "detail.section",
        "TDS section / local withholding code",
        undefined,
        kind === "TDS_DEDUCTION",
      );
    }
    add(
      "detail.fiscalYear",
      "Financial year starting",
      undefined,
      true,
      "text",
      "For April 2026 to March 2027, enter 2026.",
    );
    add(
      "detail.quarter",
      "Quarter",
      enumOptions(["Q1", "Q2", "Q3", "Q4", "ANNUAL"]),
      true,
    );
    if (kind === "TDS_DEDUCTION")
      add("detail.grossMinor", "Gross payment", undefined, true, "money");
    if (kind !== "TDS_DEDUCTION")
      add(
        "detail.form",
        "Form / return name",
        undefined,
        true,
        "text",
        "Enter the name on the official document, including current local form names.",
      );
    if (kind === "CERTIFICATE") {
      add(
        "detail.direction",
        "Direction",
        enumOptions(["ISSUED", "RECEIVED"]),
        true,
      );
      add("detail.certificateNumber", "Certificate number", undefined, true);
      add(
        "parentId",
        "Match deduction",
        p.records
          .filter((r) => r.kind === "TDS_DEDUCTION")
          .map((r) => ({ id: r.id, name: r.title })),
      );
      add("detail.deliveredOn", "Delivered on", undefined, false, "date");
    }
    if (kind === "FILING")
      add("detail.acknowledgement", "Preparation reference");
    add(
      "complianceId",
      "Compliance-calendar obligation",
      p.compliance.map((r) => ({ id: r.id, name: r.title })),
    );
    add(
      "payroll",
      "Contains payroll information",
      undefined,
      false,
      "checkbox",
      "Salary-related certificates require an explicit payroll grant and stay out of general search.",
    );
  }
  if (kind === "FUND_RULE") {
    add("endsOn", "Eligible until", undefined, true, "date");
    for (const [key, label] of [
      ["eligibilityMode", "Period and category check"],
      ["budgetMode", "Budget check"],
      ["duplicateMode", "Double-charge check"],
    ])
      add(`detail.${key}`, label, enumOptions(["BLOCK", "WARN"]), true);
  }
  add(
    "dueOn",
    kind === "DEPOSIT" ? "Expected return date" : "Due / next review date",
    undefined,
    false,
    "date",
  );
  add("reminderDays", "Remind days before due", undefined, false, "text");
  add("notes", "Notes / difference explanation", undefined, false, "textarea");
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
  return fields;
}
