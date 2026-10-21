import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import type { PayrollView } from "@/lib/finance/tools/views";
import { formatMoney } from "@/lib/format/money";
import { label } from "@/lib/finance/tools-rules";
import { ToolForm } from "./ToolForm";
import { EditPanel, AttachedFiles } from "./FinanceToolScreen";
import { PayDetails } from "./PayrollActions";
import { payrollFields } from "./PayrollFields";

export function PayrollProfiles({
  slug,
  payroll,
  currency,
}: {
  slug: string;
  payroll: NonNullable<PayrollView["payroll"]>;
  currency: string;
}) {
  const { data, files } = payroll;
  const { profileFields, payFields } = payrollFields(payroll, currency);
  return (
    <>
      {!data.profiles.length ? (
        <EmptyState
          patch
          title="No pay profiles yet. Add the first person."
          action={
            data.manage ? (
              <a
                href="#add-profile"
                className={buttonClasses({ variant: "secondary" })}
              >
                Add a pay profile
              </a>
            ) : undefined
          }
        />
      ) : null}
      {data.profiles.map((profile) => (
        <Card key={profile.id}>
          <CardHeader
            title={profile.name}
            description={`${label(profile.kind)} · ${formatMoney(profile.rateMinor, profile.currency)} per ${label(profile.rateBasis)}`}
            action={profile.archivedAt ? <Chip>Archived</Chip> : undefined}
          />
          <PayDetails slug={slug} profileId={profile.id} />
          <AttachedFiles
            slug={slug}
            files={files}
            type="PAY_PROFILE"
            id={profile.id}
            editable={data.manage}
          />
          {data.manage ? (
            <div className="mt-4 flex flex-col gap-3">
              <EditPanel title="Edit private pay profile">
                <ToolForm
                  slug={slug}
                  operation="payProfile"
                  fields={profileFields(profile)}
                  button="Save pay profile"
                />
              </EditPanel>
              {!profile.archivedAt ? (
                <EditPanel title={`Prepare ${data.period.month} pay run`}>
                  <ToolForm
                    slug={slug}
                    operation="payRun"
                    fields={payFields(profile)}
                    button="Save draft pay run"
                  />
                </EditPanel>
              ) : null}
            </div>
          ) : null}
        </Card>
      ))}
      {data.manage ? (
        <div id="add-profile">
          <EditPanel title="Add a pay profile">
            <ToolForm
              slug={slug}
              operation="payProfile"
              fields={profileFields()}
              button="Add pay profile"
              reset
            />
          </EditPanel>
        </div>
      ) : null}
    </>
  );
}
