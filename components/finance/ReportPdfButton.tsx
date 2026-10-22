"use client";
import { useState, useTransition } from "react";
import { generateReportPdfAction } from "@/app/actions/finance-tools";
import { Button, buttonClasses } from "@/components/ui/button";
import type { FinanceQuery } from "@/lib/finance/tools/queries";
export function ReportPdfButton({
  slug,
  query,
}: {
  slug: string;
  query: FinanceQuery;
}) {
  const [pending, start] = useTransition(),
    [error, setError] = useState(""),
    [id, setId] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        loading={pending}
        onClick={() =>
          start(async () => {
            setError("");
            try {
              const result = await generateReportPdfAction(slug, query);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setId(result.data.id);
            } catch {
              setError("Couldn't create the report PDF. Try again.");
            }
          })
        }
      >
        Save report PDF
      </Button>
      {id ? (
        <a
          href={`/api/files/${id}`}
          target="_blank"
          rel="noreferrer"
          className={buttonClasses({ variant: "quiet" })}
        >
          Open saved report PDF
        </a>
      ) : null}
      {error ? (
        <p role="alert" className="text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}
