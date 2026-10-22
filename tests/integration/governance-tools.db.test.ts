import { describe } from "vitest";
import "./governance-tools/fixtures";
import { registerAccessValidationTests } from "./governance-tools/access-validation.cases";
import { registerBoardRecordsTests } from "./governance-tools/board-records.cases";
import { registerVendorBankingTests } from "./governance-tools/vendor-banking.cases";
import { registerProofSearchTests } from "./governance-tools/proof-search.cases";
import { registerRemindersRestorationTests } from "./governance-tools/reminders-restoration.cases";
import { registerAssistantAccessTests } from "./governance-tools/assistant-access.cases";

describe("governance tenant boundaries and complete manual flows", () => {
  registerAccessValidationTests();
  registerBoardRecordsTests();
  registerVendorBankingTests();
  registerProofSearchTests();
  registerRemindersRestorationTests();
  registerAssistantAccessTests();
});
