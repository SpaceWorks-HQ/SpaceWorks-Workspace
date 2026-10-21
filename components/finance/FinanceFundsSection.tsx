import { buttonClasses } from "@/components/ui/button";
import { Card, CardHeader, Chip } from "@/components/ui/display";
import { ToolForm } from "./ToolForm";
import { hidden, options } from "./ToolFields";
import { centreKinds, label } from "@/lib/finance/tools-rules";
import { formatMoney } from "@/lib/format/money";
import { AttachedFiles, EditPanel, Empty } from "./FinanceToolPanels";
import type { FinanceToolContext } from "./financeToolContext";

export function FinanceFundsSection({ context }: { context: FinanceToolContext }) {
  const { data, p, files, slug, manage, fundFields } = context;
  return (
    <>
      {data.cashSummary ? (
        <Card>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">
                Restricted cash ({data.cashSummary.currency})
              </dt>
              <dd className="text-h2 tabular-nums">
                {formatMoney(
                  data.cashSummary.restrictedMinor,
                  data.cashSummary.currency,
                )}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">
                Unrestricted cash ({data.cashSummary.currency})
              </dt>
              <dd className="text-h2 tabular-nums">
                {formatMoney(
                  data.cashSummary.unrestrictedMinor,
                  data.cashSummary.currency,
                )}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-caption text-ink-muted">
            Opening account balances are unrestricted until tagged income is
            recorded.
          </p>
        </Card>
      ) : null}
      {!data.funds.length ? (
        <Empty
          text="No funds yet. Add one for the next programme."
          add={manage ? "Add a fund" : "Open requests"}
          href={manage ? "#add-record" : `/w/${slug}/requests`}
        />
      ) : null}
      {data.funds.map((f) => (
        <Card key={f.id} id={f.id}>
          <CardHeader
            title={f.name}
            description={f.funder ?? undefined}
            action={
              <Chip tone={f.restricted ? "warning" : "neutral"}>
                {f.archivedAt
                  ? "Archived"
                  : f.restricted
                    ? "Restricted"
                    : "Unrestricted"}
              </Chip>
            }
          />
          <p className="text-h2 tabular-nums">
            {formatMoney(f.balanceMinor, f.currency)}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-body-ui text-ink-muted">
            {f.notes}
          </p>
          <div className="mt-4">
            <AttachedFiles
              slug={slug}
              files={files}
              type="FUND"
              id={f.id}
              editable={manage}
            />
          </div>
          {manage ? (
            <div className="mt-4">
              <EditPanel title="Edit fund">
                <ToolForm
                  slug={slug}
                  operation="fund"
                  fields={fundFields(f)}
                  button="Save fund"
                />
              </EditPanel>
            </div>
          ) : null}
        </Card>
      ))}
      {manage ? (
        <div id="add-record">
          <EditPanel title="Add a fund">
            <ToolForm
              slug={slug}
              operation="fund"
              fields={fundFields()}
              button="Add fund"
              reset
            />
          </EditPanel>
        </div>
      ) : null}
      <Card>
        <CardHeader
          title="Cost centres"
          description="Use an event, programme, project or team. External event links are references only."
        />
        {p.centres.length ? (
          <ul className="divide-y divide-line">
            {p.centres.map((c) => (
              <li key={c.id} className="py-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <strong>{c.name}</strong>
                  <Chip>{label(c.kind)}</Chip>
                </div>
                {c.externalReference ? (
                  <p className="text-ink-muted">{c.externalReference}</p>
                ) : null}
                {c.externalUrl ? (
                  <a
                    href={c.externalUrl}
                    rel="noreferrer"
                    target="_blank"
                    className={buttonClasses({ variant: "quiet" })}
                  >
                    Open event reference
                  </a>
                ) : null}
                {manage ? (
                  <EditPanel title={`Edit ${c.name}`}>
                    <ToolForm
                      slug={slug}
                      operation="centre"
                      button="Save cost centre"
                      fields={[
                        hidden("id", c.id),
                        {
                          name: "name",
                          label: "Name",
                          required: true,
                          value: c.name,
                        },
                        {
                          name: "kind",
                          label: "Kind",
                          type: "select",
                          options: options(centreKinds),
                          value: c.kind,
                          required: true,
                        },
                        {
                          name: "projectId",
                          label: "Workspace project",
                          type: "select",
                          options: p.projects,
                          value: c.projectId ?? "",
                        },
                        {
                          name: "externalReference",
                          label: "External event reference",
                          value: c.externalReference ?? "",
                        },
                        {
                          name: "externalUrl",
                          label: "External event URL",
                          type: "url",
                          value: c.externalUrl ?? "",
                        },
                        {
                          name: "notes",
                          label: "Notes",
                          type: "textarea",
                          value: c.notes ?? "",
                        },
                        {
                          name: "archived",
                          label: "Archive this cost centre",
                          type: "checkbox",
                        },
                      ]}
                    />
                  </EditPanel>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ink-muted">
            No cost centres yet. Add one below.
          </p>
        )}
      </Card>
      {manage ? (
        <EditPanel title="Add a cost centre">
          <ToolForm
            slug={slug}
            operation="centre"
            button="Add cost centre"
            reset
            fields={[
              { name: "name", label: "Name", required: true },
              {
                name: "kind",
                label: "Kind",
                type: "select",
                options: options(centreKinds),
                value: "PROGRAMME",
                required: true,
              },
              {
                name: "projectId",
                label: "Workspace project",
                type: "select",
                options: p.projects,
              },
              {
                name: "externalReference",
                label: "External event reference",
              },
              {
                name: "externalUrl",
                label: "External event URL",
                type: "url",
              },
              { name: "notes", label: "Notes", type: "textarea" },
            ]}
          />
        </EditPanel>
      ) : null}
    </>
  );
}
