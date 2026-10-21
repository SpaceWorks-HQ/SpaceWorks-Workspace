import { type FormField } from "@/components/finance/ToolForm";
import type { ControlsView } from "@/lib/moneyControls/types";
import {
  LABELS,
  SECTIONS,
  words,
} from "@/lib/moneyControls/rules";

export function controlFilterFields(view: ControlsView): FormField[] {
  const { data, section, p } = view;
  const filterFields: FormField[] = [
    { name: "q", label: "Find a record", value: data.q.q },
    {
      name: "kind",
      label: "Record type",
      type: "select",
      value: data.q.kind,
      options: SECTIONS[section].map((id) => ({ id, name: LABELS[id] })),
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      value: data.q.status,
      options: [
        "DRAFT",
        "ACTIVE",
        "PENDING",
        "POSTED",
        "CONFIRMED",
        "ASSIGNED",
        "RETURNED",
        "PARTLY_RETURNED",
        "RECORDED",
        "PREPARED",
        "SUBMITTED",
        "ACCEPTED",
        "PAID",
        "CANCELLED",
      ].map((id) => ({ id, name: words(id) })),
    },
    {
      name: "owner",
      label: "Owner",
      type: "select",
      value: data.q.owner,
      options: p.members,
    },
    { name: "from", label: "From date", type: "date", value: data.q.from },
    { name: "to", label: "To date", type: "date", value: data.q.to },
  ];
  if (section === "funds")
    filterFields.push({
      name: "fundId",
      label: "Fund / grant",
      type: "select",
      value: data.q.fundId,
      options: p.funds,
    });
  if (section === "tds")
    filterFields.push(
      {
        name: "fiscalYear",
        label: "Financial year starting",
        value: String(data.q.fiscalYear),
      },
      {
        name: "quarter",
        label: "Quarter",
        type: "select",
        value: data.q.quarter,
        options: ["Q1", "Q2", "Q3", "Q4", "ANNUAL"].map((id) => ({
          id,
          name: id,
        })),
      },
    );
  return filterFields;
}
