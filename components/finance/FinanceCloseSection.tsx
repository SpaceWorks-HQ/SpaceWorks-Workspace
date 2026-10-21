import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader, Chip, EmptyState } from "@/components/ui/display";
import { ToolForm } from "./ToolForm";
import { hidden } from "./ToolFields";
import { AttachedFiles, EditPanel } from "./FinanceToolPanels";
import { FinanceBankReconciliation } from "./FinanceBankReconciliation";
import type { FinanceToolContext } from "./financeToolContext";

export function FinanceCloseSection({ context }: { context: FinanceToolContext }) {
  const { data, files, slug, base, manage, selectMember } = context;
  return (
    <>
      <Card>
        <CardHeader
          title={`${data.period.month} checklist`}
          action={
            <Chip tone={data.month?.signedOffAt ? "success" : "neutral"}>
              {data.month?.signedOffAt ? "Signed off" : "Open"}
            </Chip>
          }
        />
        {!data.month ? (
          <>
            <EmptyState
              patch
              title={
                manage
                  ? "No checklist for this month. Start the close."
                  : "No checklist for this month. A finance admin can start it."
              }
              action={
                !manage ? (
                  <Link
                    href={base}
                    className={buttonClasses({ variant: "secondary" })}
                  >
                    Finance overview
                  </Link>
                ) : undefined
              }
            />
            {manage ? (
              <div id="add-record" className="mt-4">
                <ToolForm
                  slug={slug}
                  operation="monthStart"
                  fields={[hidden("month", data.period.month)]}
                  button="Start month-end checklist"
                />
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col gap-4">
            {data.month.steps.map((step) => (
              <div
                key={step.id}
                className="rounded-lg border border-line p-4"
              >
                {manage && !data.month?.signedOffAt ? (
                  <ToolForm
                    slug={slug}
                    operation="step"
                    fields={[
                      hidden("id", step.id),
                      hidden("month", data.period.month),
                      {
                        name: "title",
                        label: "Step",
                        required: true,
                        value: step.title,
                      },
                      selectMember(step.ownerId),
                      {
                        name: "done",
                        label: "Done",
                        type: "checkbox",
                        value: step.done,
                      },
                      {
                        name: "notes",
                        label: "Notes",
                        type: "textarea",
                        value: step.notes ?? "",
                      },
                      {
                        name: "remove",
                        label: "Remove this step",
                        type: "checkbox",
                        helper: "Tick only when this step is not needed.",
                      },
                    ]}
                    button="Save step"
                  />
                ) : (
                  <>
                    <p>
                      {step.title} · {step.done ? "Done" : "To do"}
                    </p>
                    <p className="text-ink-muted">{step.notes}</p>
                  </>
                )}
              </div>
            ))}
            {manage && !data.month.signedOffAt ? (
              <EditPanel title="Add a checklist step">
                <ToolForm
                  slug={slug}
                  operation="step"
                  fields={[
                    hidden("month", data.period.month),
                    { name: "title", label: "Step", required: true },
                    selectMember(),
                    { name: "notes", label: "Notes", type: "textarea" },
                  ]}
                  button="Add step"
                />
              </EditPanel>
            ) : null}
            {manage ? (
              <ToolForm
                slug={slug}
                operation="close"
                fields={[
                  hidden("month", data.period.month),
                  hidden(
                    "reopen",
                    data.month.signedOffAt ? "true" : "false",
                  ),
                ]}
                button={
                  data.month.signedOffAt ? "Reopen month" : "Sign off month"
                }
              />
            ) : null}
            <AttachedFiles
              slug={slug}
              files={files}
              type="MONTH"
              id={data.month.id}
              editable={manage}
            />
          </div>
        )}
      </Card>
      <FinanceBankReconciliation context={context} />
    </>
  );
}
