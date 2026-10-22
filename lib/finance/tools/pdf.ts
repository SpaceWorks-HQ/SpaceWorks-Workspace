import "server-only";

export {
  makePayslipPdf,
} from "./pdf/payslip";
export { generatePayslip } from "./pdf/payslip-files";
export { makeReportPdf } from "./pdf/report";

export type PayslipData = import("./pdf/payslip").PayslipData;
