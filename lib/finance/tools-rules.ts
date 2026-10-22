import { recordSchemas } from "./tools-rules/record-schemas";
import { payrollSchemas } from "./tools-rules/payroll-schemas";

export {
  MAX_MINOR,
  minorSchema,
  currencySchema,
  monthSchema,
  attachmentTypes,
  type AttachmentType,
  attachmentTypeSchema,
  INCOME_SOURCES,
  centreKinds,
  disbursementKinds,
  tagsSchema,
  taxSchema,
  entryToolSchema,
} from "./tools-rules/fields";
export {
  type PayAmounts,
  payTotals,
  monthPeriod,
  billStatus,
  normalizeVendor,
  type SpendEntry,
  possibleDuplicates,
  moneyInput,
  label,
} from "./tools-rules/calculations";

export const toolSchemas = {
  ...recordSchemas,
  ...payrollSchemas,
} as const;
export type ToolOperation = keyof typeof toolSchemas;
