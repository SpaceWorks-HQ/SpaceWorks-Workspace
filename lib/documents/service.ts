import "server-only";
import type { DraftInput, Calculation, TaxProfile } from "./rules";

export type DocumentSnapshot = {
  version: 1;
  templateVersion: string;
  number: string;
  input: DraftInput;
  identity: Record<string, unknown>;
  profile: TaxProfile;
  registration: Record<string, unknown>;
  signatory: Record<string, unknown>;
  calculation: Calculation;
  letter: string;
  source: Record<string, unknown>;
  evidence?: Record<string, unknown>;
};

export { allocatePayment } from "./service/allocations";
export { saveDraft } from "./service/drafts";
export { issueDocument } from "./service/issuance";
export { cancelDocument, saveEvidence } from "./service/lifecycle";
export { getSettings, saveReference, saveSettings } from "./service/settings";
export { audit, object } from "./service/shared";
