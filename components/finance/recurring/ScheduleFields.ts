import type { ScheduleView } from "@/lib/finance/recurring/queries";
import type { FormField } from "@/components/finance/ToolForm";
import { minorToDecimalString } from "@/lib/finance/money";
import { costKinds, frequencies } from "@/lib/finance/recurring/rules";
import { hidden, select, text, date, opts } from "./Fields";

export function scheduleFields(view: ScheduleView) {
  const s = view.selected,
    currency = s?.currency ?? view.defaultCurrency;
  const amount = (v: number | undefined) =>
    minorToDecimalString(v ?? 0, currency);
  const fields: FormField[] = [
    hidden("requestKey", s?.requestKey ?? crypto.randomUUID()),
    hidden("id", s?.id ?? ""),
    text("title", "Cost name", s?.title ?? "", "text", true),
    select("kind", "Type", opts(costKinds), s?.kind ?? "RENT", true),
    text("payee", "Payee / lender", s?.payee ?? "", "text", true),
    text(
      "amountMinor",
      "Base amount before GST / withholding",
      amount(s?.amountMinor),
      "money",
      true,
    ),
    text("currency", "Currency", currency, "text", true),
    {
      name: "estimated",
      label: "Estimate — enter the actual amount each time",
      type: "checkbox",
      value: s?.estimated ?? false,
    },
    select(
      "frequency",
      "Frequency",
      opts(frequencies),
      s?.frequency ?? "MONTHLY",
      true,
    ),
    text(
      "dueDay",
      "Due day (1–31; clamps to month end)",
      String(s?.dueDay ?? 1),
      "text",
      true,
    ),
    text(
      "startsOn",
      "First period starts",
      date(s?.startsOn) || view.today,
      "date",
      true,
    ),
    text("endsOn", "End date", date(s?.endsOn), "date"),
    text(
      "leadDays",
      "Create bills this many days before due (0–90)",
      String(s?.leadDays ?? 14),
    ),
    text(
      "reminderDays",
      "Reminder lead days (0–90)",
      String(s?.reminderDays ?? 7),
    ),
    select(
      "status",
      "Status",
      opts(["ACTIVE", "PAUSED", "ENDED"]),
      s?.status ?? "ACTIVE",
      true,
    ),
    select("ownerId", "Owner", view.pickers.members, s?.ownerId ?? ""),
  ];
  const advanced: FormField[] = [
    select(
      "categoryId",
      "Expense category",
      view.pickers.categories.filter((c) => c.kind === "EXPENSE"),
      s?.categoryId ?? "",
    ),
    select(
      "accountId",
      "Payment account",
      view.pickers.accounts,
      s?.accountId ?? "",
    ),
    select("fundId", "Default fund", view.pickers.funds, s?.fundId ?? ""),
    select(
      "costCentreId",
      "Default cost centre",
      view.pickers.centres,
      s?.costCentreId ?? "",
    ),
    select("contactId", "CRM contact", view.contacts, s?.contactId ?? ""),
    select(
      "organisationId",
      "CRM organisation",
      view.organisations,
      s?.organisationId ?? "",
    ),
    text(
      "gstPercent",
      "GST % (review applicability)",
      String(s?.gstPercent ?? 0),
    ),
    text("tdsSection", "TDS section / withholding code", s?.tdsSection ?? ""),
    text(
      "tdsPercent",
      "TDS % (review applicability)",
      String(s?.tdsPercent ?? 0),
    ),
    select("leaseId", "Facility lease", view.leases, s?.leaseId ?? ""),
    select(
      "subscriptionId",
      "Subscription",
      view.subscriptions,
      s?.subscriptionId ?? "",
    ),
    select(
      "insuranceId",
      "Insurance register entry",
      view.insurance,
      s?.insuranceId ?? "",
    ),
    select(
      "depositId",
      "Security deposit in Money controls",
      view.deposits,
      s?.depositId ?? "",
    ),
    text("renewalOn", "Rent renewal date", date(s?.renewalOn), "date"),
    text(
      "escalationPercent",
      "Rent escalation % to agree at renewal",
      String(s?.escalationPercent ?? 0),
    ),
    text(
      "renewalReminderDays",
      "Remind before renewal (days)",
      String(s?.renewalReminderDays ?? 30),
    ),
    text(
      "principalMinor",
      "Loan principal (EMI only)",
      amount(s?.principalMinor),
      "money",
    ),
    text(
      "annualRatePercent",
      "Annual loan interest % (reference only)",
      String(s?.annualRatePercent ?? 0),
    ),
    text("tenure", "Number of EMIs", String(s?.tenure ?? 0)),
    text("notes", "Notes", s?.notes ?? "", "textarea"),
  ];
  return { fields, advanced };
}
