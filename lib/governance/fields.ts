import { LABELS, STATUSES, type Kind } from "./schemas";
import { opts, optional } from "./fields/options";
import { detailFields } from "./fields/detail-fields";
export type Choice = { value: string; label: string };
export type Choices = {
  owners: Choice[];
  committees: Choice[];
  organisations: Choice[];
  vendors: Choice[];
  meetings: Choice[];
  contacts: Choice[];
  docs: Choice[];
  obligations: Choice[];
  entities: Choice[];
  plans: Choice[];
  decisions: Choice[];
  evidence: Choice[];
};
export type FieldSpec = {
  name: string;
  label: string;
  type?:
    | "textarea"
    | "select"
    | "number"
    | "date"
    | "email"
    | "multi"
    | "checkbox";
  required?: boolean;
  options?: Choice[];
  value?: string | number;
  help?: string;
  max?: number;
};
export function recordFields(kind: Kind, choices: Choices): FieldSpec[] {
  const fields: FieldSpec[] = [
    {
      name: "title",
      label:
        kind === "LEGAL_ENTITY"
          ? "Registered legal name"
          : `${LABELS[kind]} name`,
      required: true,
    },
    {
      name: "ownerId",
      label: "Responsible admin",
      type: "select",
      options: optional(choices.owners),
    },
    {
      name: "status",
      label: "Status",
      type: "select",
      required: true,
      options: opts(
        STATUSES[kind].filter((s) => s !== "APPROVED" && s !== "FROZEN"),
      ),
    },
  ];
  if (["TERM", "MINUTES", "RESOLUTION", "CONFLICT", "AGM_ITEM"].includes(kind))
    fields.push({
      name: "parentId",
      label: "Board or committee",
      type: "select",
      options: optional(choices.committees),
      required: true,
    });
  if (["MINUTES", "RESOLUTION", "CONFLICT", "AGM_ITEM"].includes(kind))
    fields.push({
      name: "meetingId",
      label: "Existing meeting",
      type: "select",
      options: optional(choices.meetings),
      required: kind === "MINUTES",
      help: "Schedule and manage attendees in Meetings. Governance keeps only this link.",
    });
  if (
    [
      "OBLIGATION",
      "AGM_ITEM",
      "CONFLICT",
      "STATUTORY_REGISTER",
      "RISK",
      "EMERGENCY_PLAN",
      "DRILL",
      "SOP_REVIEW",
    ].includes(kind)
  )
    fields.push({
      name: "dueOn",
      label: kind === "CONFLICT" ? "Declaration date" : "Due date",
      type: "date",
      required: true,
    });
  if (
    [
      "TERM",
      "CONTRACT",
      "INSURANCE",
      "LICENCE",
      "REGISTRATION",
      "BOARD_PACK",
    ].includes(kind)
  )
    fields.push(
      { name: "startsOn", label: "Start date", type: "date", required: true },
      { name: "endsOn", label: "End date", type: "date", required: true },
    );
  if (
    [
      "OBLIGATION",
      "TERM",
      "CONTRACT",
      "AGM_ITEM",
      "INSURANCE",
      "LICENCE",
      "REGISTRATION",
      "STATUTORY_REGISTER",
      "RISK",
      "EMERGENCY_PLAN",
      "DRILL",
      "SOP_REVIEW",
    ].includes(kind)
  )
    fields.push({
      name: "reminderDays",
      label: "Remind days before",
      type: "number",
      value: 7,
      max: 365,
      help:
        kind === "CONTRACT"
          ? "Before the notice deadline (end date minus notice period)."
          : "Owner receives a reminder before the deadline and once when overdue.",
    });
  fields.push(...detailFields(kind, choices));
  fields.push({ name: "notes", label: "Notes", type: "textarea" });
  return fields;
}
