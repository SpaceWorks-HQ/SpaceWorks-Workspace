import "server-only";
import {
  addEntry,
  payBill,
  saveBill,
  saveBudget,
  saveCentre,
  saveEntryTags,
  saveFund,
} from "@/lib/finance/tools/service";
import {
  addAccount,
  closeMonth,
  markReconciled,
  reconcileAccount,
  reviewSpending,
  saveStep,
  startMonth,
} from "@/lib/finance/tools/close";
import {
  grantPayroll,
  savePayProfile,
  savePayRun,
  savePayBookkeeping,
  transitionPayRun,
} from "@/lib/finance/tools/payroll";
import {
  saveDisbursement,
  transitionDisbursement,
} from "@/lib/finance/tools/disbursements";
import { remindReceipt, saveReviewRule } from "@/lib/scheduled/financeTools";

export const handlers = {
  fund: saveFund,
  centre: saveCentre,
  budget: saveBudget,
  entry: addEntry,
  tags: saveEntryTags,
  bill: saveBill,
  billPayment: payBill,
  account: addAccount,
  monthStart: startMonth,
  step: saveStep,
  mark: markReconciled,
  reconcile: reconcileAccount,
  close: closeMonth,
  review: reviewSpending,
  threshold: saveReviewRule,
  remind: remindReceipt,
  grant: grantPayroll,
  payProfile: savePayProfile,
  payRun: savePayRun,
  payTransition: transitionPayRun,
  payBookkeeping: savePayBookkeeping,
  disbursement: saveDisbursement,
  disbursementTransition: transitionDisbursement,
};
