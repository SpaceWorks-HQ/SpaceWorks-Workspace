import { LABELS, STATUSES, label, type Kind } from "./schemas";
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
const opts = (values: string[]) =>
  values.map((value) => ({ value, label: label(value) }));
const optional = (values: Choice[]) => [
  { value: "", label: "None" },
  ...values,
];
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
  const add = (
    name: string,
    label: string,
    extra: Omit<FieldSpec, "name" | "label"> = {},
  ) => fields.push({ name: `details.${name}`, label, ...extra });
  if (kind === "LEGAL_ENTITY") {
    add("entityType", "Entity type", {
      type: "select",
      required: true,
      options: [
        { value: "SECTION_8", label: "Section 8 company" },
        { value: "SOCIETY", label: "Society" },
        { value: "TRUST", label: "Trust" },
        { value: "OTHER", label: "Other / international" },
      ],
    });
    for (const [name, title] of [
      ["registration", "Registration number"],
      ["pan", "PAN"],
      ["tan", "TAN"],
      ["gstin", "GSTIN (if registered)"],
      ["charity12a", "12A / 12AB registration"],
      ["charity80g", "80G approval"],
      ["fcra", "FCRA registration (if applicable)"],
      ["csr1", "CSR-1 registration (if applicable)"],
    ])
      add(name, title);
    add("address", "Registered address", { type: "textarea" });
    add("otherIds", "Other / international registration details", {
      type: "textarea",
    });
  }
  if (kind === "OBLIGATION") {
    add("recurrence", "Recurrence", {
      type: "select",
      options: opts(["NONE", "MONTHLY", "QUARTERLY", "ANNUALLY"]),
      help: "After filing, add the next occurrence manually. The original proof stays with this filing.",
    });
    add("acknowledgement", "Acknowledgement number");
    add("applicability", "Applies to / reporting period");
  }
  if (kind === "COMMITTEE") {
    add("committeeType", "Type", {
      type: "select",
      options: opts(["BOARD", "COMMITTEE"]),
    });
    add("mandate", "Mandate", { type: "textarea" });
  }
  if (kind === "TERM") {
    add("person", "Member name", { required: true });
    add("position", "Role on the committee");
    add("contactId", "CRM contact", {
      type: "select",
      options: optional(choices.contacts),
    });
  }
  if (kind === "MINUTES")
    add("content", "Minutes", {
      type: "textarea",
      required: true,
      help: "Save the draft, attach supporting files, then approve. Approval locks the text and attachments.",
    });
  if (kind === "RESOLUTION") {
    add("content", "Resolution text", { type: "textarea", required: true });
    add("outcome", "Voting result / outcome", { type: "textarea" });
  }
  if (kind === "CONFLICT") {
    add("partyOrgId", "Declared party / CRM organisation", {
      type: "select",
      options: optional(choices.organisations),
    });
    add("partyName", "Declared payee name", {
      help: "Used for exact, case-insensitive payee warnings. Verify aliases manually.",
    });
    add("person", "Declarant name", { required: true });
    add("declaration", "Declaration", {
      type: "textarea",
      required: true,
      help: "Record relevant interests or explicitly record no conflict.",
    });
    add("management", "Management / recusal notes", { type: "textarea" });
  }
  if (kind === "AGM_ITEM")
    add("year", "AGM year", {
      required: true,
      value: new Date().getFullYear().toString(),
    });
  if (kind === "VENDOR") {
    fields.push({
      name: "organisationId",
      label: "Existing CRM organisation",
      type: "select",
      options: optional(choices.organisations),
      required: true,
      help: "Create the organisation in Contacts first. This record adds vendor details without duplicating it.",
    });
    add("gstin", "GSTIN");
    add("pan", "PAN");
    add("overseasTaxId", "Other / overseas tax ID");
    add("email", "Vendor email", { type: "email" });
    add("phone", "Vendor phone");
  }
  if (kind === "CONTRACT") {
    add("vendorId", "Vendor / contracting party", {
      type: "select",
      options: optional(choices.vendors),
      required: true,
    });
    add("amount", "Contract value", {
      required: true,
      help: "Enter the full value, for example 12500.50.",
    });
    add("currency", "Currency", { value: "INR", required: true });
    add("noticeDays", "Notice period in days", {
      type: "number",
      value: 30,
      max: 3650,
      required: true,
    });
    add("reference", "Contract reference");
  }
  if (["INSURANCE", "LICENCE", "REGISTRATION"].includes(kind)) {
    add("issuer", "Issuer", { required: true });
    add("reference", "Policy / licence / registration number", {
      required: true,
    });
    add("scope", "Coverage or scope", { type: "textarea" });
    add("sumInsured", "Sum insured", {
      value: "0",
      help: "Full currency amount; leave zero when not applicable.",
    });
    add("premium", "Premium or fee", { value: "0" });
    add("currency", "Currency", { value: "INR", required: true });
    add("obligationId", "Compliance calendar item", {
      type: "select",
      options: optional(choices.obligations),
    });
  }
  if (kind === "STATUTORY_REGISTER") {
    add("entityId", "Legal entity", {
      type: "select",
      options: choices.entities,
      required: true,
    });
    add("registerType", "Register", {
      type: "select",
      options: opts(["MEMBERS", "DIRECTORS", "MINUTES", "OTHER"]),
    });
    add("scope", "Scope / external register location", {
      type: "textarea",
      help: "Upload the reviewed register snapshot below. Review dates are manual.",
    });
  }
  if (kind === "RISK") {
    add("likelihood", "Likelihood (1–5)", {
      type: "number",
      value: 1,
      max: 5,
      required: true,
    });
    add("impact", "Impact (1–5)", {
      type: "number",
      value: 1,
      max: 5,
      required: true,
    });
    add("assessment", "Assessment / affected people", { type: "textarea" });
    add("controls", "Controls and corrective work", {
      type: "textarea",
      required: true,
    });
  }
  if (kind === "EMERGENCY_PLAN" || kind === "SOP_REVIEW") {
    add("docId", "Existing document", {
      type: "select",
      options: choices.docs,
      required: true,
    });
    add(
      kind === "SOP_REVIEW" ? "reviewNote" : "scope",
      kind === "SOP_REVIEW" ? "Review note" : "Scope",
      { type: "textarea" },
    );
  }
  if (kind === "DRILL") {
    add("planId", "Emergency plan", {
      type: "select",
      options: choices.plans,
      required: true,
    });
    add("findings", "Drill findings", { type: "textarea" });
    add("actions", "Follow-up actions", { type: "textarea" });
  }
  if (kind === "BOARD_PACK") {
    add("docIds", "Select reports / documents", {
      type: "multi",
      options: choices.docs,
    });
    add("decisionIds", "Select decisions", {
      type: "multi",
      options: choices.decisions,
    });
    add("recordIds", "Select governance evidence", {
      type: "multi",
      options: choices.evidence,
    });
    add("includeFinance", "Include period finance summary", {
      type: "checkbox",
      help: "Excludes individual payroll details. Currencies stay separate.",
    });
    add("currency", "Finance currency", { value: "INR" });
  }
  fields.push({ name: "notes", label: "Notes", type: "textarea" });
  return fields;
}
