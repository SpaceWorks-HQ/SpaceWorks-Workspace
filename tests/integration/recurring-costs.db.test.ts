import { describe } from "vitest";
import "./recurring-costs/fixtures";
import { registerScheduleTests } from "./recurring-costs/schedules.cases";
import { registerUtilityTaxPaymentTests } from "./recurring-costs/utility-tax-payments.cases";
import { registerEmiRentSourceTests } from "./recurring-costs/emi-rent-sources.cases";
import { registerPayrollRemittanceTests } from "./recurring-costs/payroll-remittances.cases";
import { registerStaffAdvanceTests } from "./recurring-costs/staff-advances.cases";
import { registerEvidenceAccessTests } from "./recurring-costs/evidence-access.cases";
import { registerScheduledReminderTests } from "./recurring-costs/scheduled-reminders.cases";
import { registerCashFlowTests } from "./recurring-costs/cash-flow.cases";
import { registerActionPermissionTests } from "./recurring-costs/action-permissions.cases";

describe.sequential("manual recurring finance", () => {
  registerScheduleTests();
  registerUtilityTaxPaymentTests();
  registerEmiRentSourceTests();
  registerPayrollRemittanceTests();
  registerStaffAdvanceTests();
  registerEvidenceAccessTests();
  registerScheduledReminderTests();
  registerCashFlowTests();
  registerActionPermissionTests();
});
