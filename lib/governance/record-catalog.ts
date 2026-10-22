export const KINDS = [
  "LEGAL_ENTITY",
  "OBLIGATION",
  "COMMITTEE",
  "TERM",
  "MINUTES",
  "RESOLUTION",
  "CONFLICT",
  "AGM_ITEM",
  "VENDOR",
  "CONTRACT",
  "INSURANCE",
  "LICENCE",
  "REGISTRATION",
  "STATUTORY_REGISTER",
  "RISK",
  "EMERGENCY_PLAN",
  "DRILL",
  "SOP_REVIEW",
  "BOARD_PACK",
] as const;
export type Kind = (typeof KINDS)[number];
export type Section =
  | "compliance"
  | "board"
  | "vendors"
  | "registers"
  | "risk"
  | "reviews"
  | "packs";
export const SECTIONS: Record<Section, Kind[]> = {
  registers: ["INSURANCE", "LICENCE", "REGISTRATION", "STATUTORY_REGISTER"],
  risk: ["RISK", "EMERGENCY_PLAN", "DRILL"],
  reviews: ["SOP_REVIEW"],
  packs: ["BOARD_PACK"],
  compliance: ["LEGAL_ENTITY", "OBLIGATION"],
  board: ["COMMITTEE", "TERM", "MINUTES", "RESOLUTION", "CONFLICT", "AGM_ITEM"],
  vendors: ["VENDOR", "CONTRACT"],
};
export const LABELS: Record<Kind, string> = {
  LEGAL_ENTITY: "Legal entity",
  OBLIGATION: "Obligation",
  COMMITTEE: "Board or committee",
  TERM: "Committee member",
  MINUTES: "Minutes",
  RESOLUTION: "Resolution",
  CONFLICT: "Conflict declaration",
  AGM_ITEM: "AGM checklist item",
  VENDOR: "Vendor",
  CONTRACT: "Contract",
  INSURANCE: "Insurance policy",
  LICENCE: "Licence",
  REGISTRATION: "Registration",
  STATUTORY_REGISTER: "Statutory register",
  RISK: "Risk assessment",
  EMERGENCY_PLAN: "Emergency plan",
  DRILL: "Drill record",
  SOP_REVIEW: "SOP or policy review",
  BOARD_PACK: "Board or report pack",
};
export const STATUSES: Record<Kind, string[]> = {
  INSURANCE: ["ACTIVE", "EXPIRED", "CANCELLED"],
  LICENCE: ["ACTIVE", "EXPIRED", "CANCELLED"],
  REGISTRATION: ["ACTIVE", "EXPIRED", "CANCELLED"],
  STATUTORY_REGISTER: ["CURRENT", "NEEDS_REVIEW"],
  RISK: ["OPEN", "CONTROLLED", "CLOSED"],
  EMERGENCY_PLAN: ["ACTIVE", "NEEDS_REVIEW"],
  DRILL: ["PLANNED", "DONE"],
  SOP_REVIEW: ["DUE", "REVIEWED"],
  BOARD_PACK: ["DRAFT", "FROZEN"],
  LEGAL_ENTITY: ["ACTIVE"],
  OBLIGATION: ["TODO", "FILED", "DONE"],
  COMMITTEE: ["ACTIVE", "CLOSED"],
  TERM: ["ACTIVE", "ENDED"],
  MINUTES: ["DRAFT", "APPROVED"],
  RESOLUTION: ["DRAFT", "PASSED", "REJECTED"],
  CONFLICT: ["DECLARED", "REVIEWED"],
  AGM_ITEM: ["TODO", "DONE"],
  VENDOR: ["ACTIVE", "INACTIVE"],
  CONTRACT: ["DRAFT", "ACTIVE", "ENDED", "CANCELLED"],
};
export const label = (s: string) =>
  ({ TODO: "To do", AGM_ITEM: "AGM checklist item" })[s] ??
  s
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
export const sectionFor = (kind: Kind): Section =>
  (Object.keys(SECTIONS) as Section[]).find((s) => SECTIONS[s].includes(kind))!;
export const sectionPath = (section: Section) =>
  section === "compliance" ? "" : `/${section}`;
