import type { UpcomingView } from "@/lib/finance/recurring/queries";
import { minorToDecimalString } from "@/lib/finance/money";
import { RecurringForm } from "./Forms";
import { hidden, text } from "./Fields";

export function DueActualForm({
  slug,
  r,
}: {
  slug: string;
  r: UpcomingView["rows"][number];
}) {
  return (
    <RecurringForm
      slug={slug}
      operation="actual"
      fields={[
        hidden("billId", r.billId!),
        hidden("currency", r.currency),
        text(
          "amountMinor",
          "Cash payable after withholding",
          minorToDecimalString(
            r.amountMinor,
            r.currency,
          ),
          "money",
          true,
        ),
        ...(r.kind === "EMI"
          ? [
              text(
                "principalMinor",
                "Principal",
                minorToDecimalString(
                  r.principalMinor,
                  r.currency,
                ),
                "money",
                true,
              ),
              text(
                "interestMinor",
                "Interest",
                minorToDecimalString(
                  r.interestMinor,
                  r.currency,
                ),
                "money",
                true,
              ),
            ]
          : [
              text(
                "cgstMinor",
                "CGST included",
                minorToDecimalString(
                  r.cgstMinor ?? 0,
                  r.currency,
                ),
                "money",
              ),
              text(
                "sgstMinor",
                "SGST / UTGST included",
                minorToDecimalString(
                  r.sgstMinor ?? 0,
                  r.currency,
                ),
                "money",
              ),
              text(
                "igstMinor",
                "IGST included",
                minorToDecimalString(
                  r.igstMinor ?? 0,
                  r.currency,
                ),
                "money",
              ),
              text(
                "tdsMinor",
                "TDS withheld",
                minorToDecimalString(
                  r.tdsMinor,
                  r.currency,
                ),
                "money",
              ),
            ]),
      ]}
      button="Confirm actual amount"
    />
  );
}
