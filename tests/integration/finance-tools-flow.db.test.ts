import { describe } from "vitest";
import "./finance-tools-flow/fixtures";
import { registerAccessValidationTests } from "./finance-tools-flow/access-validation.cases";
import { registerBillsBudgetsTests } from "./finance-tools-flow/bills-budgets.cases";
import { registerProofExtractionTests } from "./finance-tools-flow/proof-extraction.cases";
import { registerReportsSearchTests } from "./finance-tools-flow/reports-search.cases";
import { registerRemindersTests } from "./finance-tools-flow/reminders.cases";
import { registerPayrollApprovalsTests } from "./finance-tools-flow/payroll-approvals.cases";
import { registerPayrollPrivacyTests } from "./finance-tools-flow/payroll-privacy.cases";
import { registerDisbursementsTests } from "./finance-tools-flow/disbursements.cases";
import { registerMonthCloseExportsTests } from "./finance-tools-flow/month-close-exports.cases";

describe.sequential("manual finance access and records", () => {
  registerAccessValidationTests();
  registerBillsBudgetsTests();
  registerProofExtractionTests();
  registerReportsSearchTests();
  registerRemindersTests();
});

describe.sequential("payroll privacy and manual approvals", () => {
  registerPayrollApprovalsTests();
  registerPayrollPrivacyTests();
});

describe.sequential("disbursements, month-end and export routes", () => {
  registerDisbursementsTests();
  registerMonthCloseExportsTests();
});
