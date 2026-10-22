import type { TaxProfile } from "@/lib/documents/types";
import { label } from "@/lib/documents/rules";
import { DocumentForm } from "@/components/documents/DocumentForm";
import { text } from "./settings-fields";

export function DocumentProfileSettings({
  workspaceSlug,
  profile,
  assetOptions,
}: {
  workspaceSlug: string;
  profile: TaxProfile;
  assetOptions: Array<{ id: string; name: string }>;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
      <h2 className="text-h3">Organisation defaults</h2>
      <DocumentForm
        slug={workspaceSlug}
        operation="profile"
        label="Save document defaults"
        fields={[
          text(
            "country",
            "Country code (IN / GB / US / other)",
            profile.country,
          ),
          {
            name: "fiscalStartMonth",
            label: "Fiscal year start month",
            type: "number",
            value: profile.fiscalStartMonth,
          },
          {
            name: "gstScheme",
            label: "GST scheme",
            type: "select",
            value: profile.gstScheme,
            options: ["REGULAR", "COMPOSITION", "UNREGISTERED"].map((id) => ({
              id,
              name: label(id),
            })),
          },
          {
            name: "eInvoiceRequired",
            label: "E-invoicing applies to this organisation (reviewed)",
            type: "checkbox",
            value: profile.eInvoiceRequired,
          },
          text("cin", "CIN / company registration", profile.cin),
          text("contact", "Company contact particulars", profile.contact),
          text("upi", "Verified UPI ID", profile.upi),
          {
            name: "upiVerified",
            label: "Payment instructions independently verified",
            type: "checkbox",
            value: profile.upiVerified,
          },
          {
            name: "paymentInstructions",
            label: "Payment instructions",
            type: "textarea",
            value: profile.paymentInstructions,
          },
          {
            name: "logoFileId",
            label: "Organisation logo",
            type: "select",
            value: profile.logoFileId,
            options: assetOptions,
          },
          text("footer", "Document footer", profile.footer),
          {
            name: "applicability",
            label:
              "GST / turnover applicability decision and supporting advice",
            type: "textarea",
            value: profile.applicability,
          },
          {
            name: "reviewedOn",
            label: "Applicability reviewed on",
            type: "date",
            value: profile.reviewedOn,
          },
        ]}
      />
    </section>
  );
}
