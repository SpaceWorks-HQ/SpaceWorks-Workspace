import { describe } from "vitest";
import "./money-controls/fixtures";
import { registerAccessVouchersTests } from "./money-controls/access-vouchers.cases";
import { registerCashMovementsTests } from "./money-controls/cash-movements.cases";
import { registerCashCustodyTests } from "./money-controls/cash-custody.cases";
import { registerPrivateEvidenceTests } from "./money-controls/private-evidence.cases";
import { registerAssetsTests } from "./money-controls/assets.cases";
import { registerCertificatesTests } from "./money-controls/certificates.cases";
import { registerFundCommitmentsTests } from "./money-controls/fund-commitments.cases";
import { registerRemindersTests } from "./money-controls/reminders.cases";
import { registerActionsQueriesTests } from "./money-controls/actions-queries.cases";
import { registerRevocationRetentionTests } from "./money-controls/revocation-retention.cases";

describe("internal money controls", () => {
  registerAccessVouchersTests();
  registerCashMovementsTests();
  registerCashCustodyTests();
  registerPrivateEvidenceTests();
  registerAssetsTests();
  registerCertificatesTests();
  registerFundCommitmentsTests();
  registerRemindersTests();
  registerActionsQueriesTests();
  registerRevocationRetentionTests();
});
