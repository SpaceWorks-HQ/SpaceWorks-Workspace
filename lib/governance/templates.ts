/** Planning prompts only; users enter CA-confirmed deadlines and applicability. */
export const COMPLIANCE_TEMPLATES = [
  {
    name: "12A / 12AB registration renewal",
    recurrence: "NONE",
    applies: "Registered charities; check the approval order and expiry.",
  },
  {
    name: "80G approval renewal",
    recurrence: "NONE",
    applies: "Entities with 80G approval; check the approval order and expiry.",
  },
  {
    name: "Form 10BD donation statement",
    recurrence: "ANNUALLY",
    applies:
      "Where donation reporting is applicable. Verify the form for the relevant tax year.",
  },
  {
    name: "Form 10BE donor certificates",
    recurrence: "ANNUALLY",
    applies:
      "Where donation certificates are applicable. Verify the form for the relevant tax year.",
  },
  {
    name: "ITR-7 / applicable income tax return",
    recurrence: "ANNUALLY",
    applies: "Confirm the applicable return and reporting year with your CA.",
  },
  {
    name: "Audit report (Form 10B / 10BB as applicable)",
    recurrence: "ANNUALLY",
    applies: "Where audit is required; confirm the form and threshold.",
  },
  {
    name: "TDS return",
    recurrence: "QUARTERLY",
    applies: "Where tax has been deducted; confirm the applicable return.",
  },
  {
    name: "GST return",
    recurrence: "MONTHLY",
    applies: "Only if GST registered; confirm the actual filing frequency.",
  },
  {
    name: "FCRA annual return (FC-4)",
    recurrence: "ANNUALLY",
    applies:
      "Only where FCRA registration or permission applies; confirm nil-return requirements.",
  },
  {
    name: "CSR-1 registration review",
    recurrence: "NONE",
    applies: "Where acting as an eligible CSR implementing entity.",
  },
  {
    name: "AOC-4 financial statements",
    recurrence: "ANNUALLY",
    applies: "Section 8 companies, where applicable.",
  },
  {
    name: "MGT-7 / applicable annual return",
    recurrence: "ANNUALLY",
    applies: "Section 8 companies; confirm the applicable form.",
  },
  {
    name: "Society annual filing",
    recurrence: "ANNUALLY",
    applies: "Societies; state registrar requirements vary.",
  },
  {
    name: "Trust annual filing",
    recurrence: "ANNUALLY",
    applies: "Trusts; state charity authority requirements vary.",
  },
] as const;
