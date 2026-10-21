import { Card, CardHeader, Chip } from "@/components/ui/display";
import { formatMoney } from "@/lib/format/money";
import { formatDay } from "@/lib/finance/dates";
import type { FinanceReportsView } from "@/lib/finance/tools/views";
import { INCOME_SOURCES, label } from "@/lib/finance/tools-rules";
import { ToolForm } from "./ToolForm";
import { hidden, options, tagFields } from "./ToolFields";
import { EditPanel, AttachedFiles } from "./FinanceToolScreen";
import { FilePreviews } from "./FinanceAttachments";

export function FinanceReportEntries({ view, entries, slug, page, print, spending }: {
  view: FinanceReportsView;
  entries: FinanceReportsView["data"]["entries"];
  slug: string;
  page: number;
  print: boolean;
  spending: boolean;
}) {
  const { data, pickers: p, manage, files } = view;
  const c = data.period.currency;
  return (
    <Card>
      <CardHeader
        title="Entries and receipts"
        description={
          !print
            ? `Page ${page}. Payroll records are in the pay register.`
            : undefined
        }
      />
      <div className="flex flex-col gap-4">
        {entries.map((e) => (
          <article
            key={e.id}
            className="break-inside-avoid rounded-lg border border-line p-4"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <strong>{e.description}</strong>
              <Chip tone={e.kind === "INCOME" ? "success" : "neutral"}>
                {label(e.kind)} · {formatMoney(e.amountMinor, c)}
              </Chip>
            </div>
            <p className="mt-1 text-ink-muted">
              {formatDay(e.occurredOn)} ·{" "}
              {e.counterparty ?? "No vendor or funder"} ·{" "}
              {e.category?.name ?? "Uncategorised"} ·{" "}
              {e.costCentre?.name ?? "No cost centre"}
            </p>
            {e.purpose ? <p>{e.purpose}</p> : null}
            <FilePreviews files={e.receipts} />
            {manage && spending ? (
              <div className="mt-4">
                <EditPanel title="Receipts and bookkeeping">
                  <AttachedFiles
                    slug={slug}
                    files={files}
                    type="LEDGER"
                    id={e.id}
                    editable
                  />
                  <div className="mt-4">
                    <ToolForm
                      slug={slug}
                      operation="tags"
                      fields={[
                        hidden("entryId", e.id),
                        ...tagFields(p, e),
                        {
                          name: "incomeSource",
                          label: "Income source",
                          type: "select",
                          options: options(INCOME_SOURCES),
                          value: e.incomeSource,
                        },
                        {
                          name: "invoiceNumber",
                          label: "Invoice number",
                          value: e.invoiceNumber ?? "",
                        },
                      ]}
                      button="Save bookkeeping"
                    />
                  </div>
                </EditPanel>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </Card>
  );
}
