import type { KeyResult } from "@prisma/client";
import { resultProgress } from "@/lib/goals/progress";
import { formatDayTime } from "@/lib/format/datetime";
import { goalAction } from "@/app/actions/goals";
import { ActionForm } from "@/components/meetings/ActionForm";
import { Section, TextBody } from "@/components/meetings/Structure";

export function GoalKeyResults({
  keyResults,
  workspaceSlug,
  goalId,
  timezone,
  canEdit,
  options,
}: {
  keyResults: KeyResult[];
  workspaceSlug: string;
  goalId: string;
  timezone: string;
  canEdit: boolean;
  options: (values: string[]) => { value: string; label: string }[];
}) {
  return (
    <>
      {keyResults.map((kr) => (
        <Section key={kr.id} title={kr.title}>
          <p>
            {kr.metricType === "BOOLEAN"
              ? kr.current
                ? "Complete"
                : "Incomplete"
              : `${kr.current} of ${kr.target}${kr.metricType === "PERCENT" ? "%" : ""}`}{" "}
            · {Math.round(resultProgress(kr))}%
          </p>
          <progress
            className="h-3 w-full accent-[var(--yy-primary)]"
            aria-label={`${kr.title} progress`}
            value={resultProgress(kr)}
            max={100}
          />
          <details>
            <summary className="min-h-11 cursor-pointer text-accent-text">
              Check-in history
            </summary>
            <ul>
              {(Array.isArray(kr.checkIns) ? kr.checkIns : []).map(
                (entry, i) => {
                  const c = entry as {
                    at: string;
                    value: number;
                    note: string;
                    confidence?: string;
                  };
                  return (
                    <li key={i} className="space-y-1 border-b border-line py-3">
                      <p className="text-caption text-ink-muted">
                        {formatDayTime(c.at, timezone)} ·{" "}
                        {c.value} · Confidence:{" "}
                        {c.confidence?.toLowerCase() ?? "Not recorded"}
                      </p>
                      <TextBody>{c.note}</TextBody>
                    </li>
                  );
                },
              )}
            </ul>
          </details>
          {canEdit ? (
            <ActionForm
              slug={workspaceSlug}
              action={goalAction}
              hidden={{ op: "checkin", goalId, resultId: kr.id }}
              label="Record check-in"
              fields={[
                {
                  name: "value",
                  label:
                    kr.metricType === "BOOLEAN"
                      ? "Value: 0 incomplete, 1 complete"
                      : "Current value",
                  type: "number",
                  value: kr.current,
                  required: true,
                },
                {
                  name: "confidence",
                  label: "Confidence",
                  type: "select",
                  options: options(["HIGH", "MEDIUM", "LOW"]),
                  required: true,
                },
                { name: "note", label: "Check-in note", type: "textarea" },
              ]}
            />
          ) : null}
        </Section>
      ))}
    </>
  );
}
