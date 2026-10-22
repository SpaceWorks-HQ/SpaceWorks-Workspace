import {
  Chip,
} from "@/components/ui/display";
import { formatDate } from "@/lib/format/datetime";
import { formatMoney } from "@/lib/format/money";
import type { ControlsView } from "@/lib/moneyControls/types";
import {
  words,
} from "@/lib/moneyControls/rules";
import { ControlForm } from "./ControlForm";
import { Proofs, ReconcileMovement } from "./Proofs";
import type { ControlRow } from "@/lib/moneyControls/types";
import type { controlRecordActions } from "./recordActions";

export function ControlRecordHistory({ view, r, editable, draft, actions, actionLabel }: {
  view: ControlsView;
  r: ControlRow;
  editable: boolean;
  draft: boolean;
  actions: string[];
  actionLabel: ReturnType<typeof controlRecordActions>["actionLabel"];
}) {
  const { actor, p, edit, today } = view;
  const timezone = actor.workspace.timezone;
  const name = (id: string | null) =>
    p.members.find((m) => m.id === id)?.name ?? "Former member";
  return (
    <>
      <details className="mt-3" open={edit === r.id}>
        <summary className="min-h-11 cursor-pointer text-label">
          Proof and history
        </summary>
        <Proofs
          slug={actor.workspace.slug}
          recordId={r.id}
          files={r.files}
          editable={editable}
          removable={draft}
        />
        <ol className="mt-4 space-y-2 text-caption text-ink-muted">
          {r.events.map((e) => (
            <li key={e.id}>
              {formatDate(e.createdAt, timezone)} · {words(e.action)} ·{" "}
              {name(e.actorId)}
              {e.reference ? ` · ${e.reference}` : ""}
              {e.notes ? ` · ${e.notes}` : ""}
            </li>
          ))}
        </ol>
      </details>
      {r.movements.length ? (
        <details className="mt-3">
          <summary className="min-h-11 cursor-pointer text-label">
            Account movements
          </summary>
          <ul>
            {r.movements.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3"
              >
                <span>
                  {p.accounts.find((a) => a.id === m.accountId)?.name ??
                    "Account"}{" "}
                  · {formatDate(m.occurredOn, "UTC")} ·{" "}
                  {formatMoney(m.amountMinor, m.currency)} · {m.reference}
                </span>
                {m.reconciledAt ? (
                  <Chip>Reconciled</Chip>
                ) : editable ? (
                  <ReconcileMovement
                    slug={actor.workspace.slug}
                    id={m.id}
                  />
                ) : (
                  <Chip>Unchecked</Chip>
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {actions.length ? (
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer text-label">
            Record the next step
          </summary>
          <div className="flex flex-col gap-5">
            {actions.map((op) => (
              <ControlForm
                key={op}
                transition
                slug={actor.workspace.slug}
                label={actionLabel(op)}
                hidden={{ id: r.id, operation: op }}
                fields={[
                  {
                    name: "occurredOn",
                    label:
                      op === "RETURN" ? "Return date" : "Action date",
                    type: "date",
                    value: today,
                    required: true,
                  },
                  {
                    name: "reference",
                    label: "Acknowledgement / payment reference",
                    required: ![
                      "ACKNOWLEDGE",
                      "CANCEL",
                      "REQUEST",
                      "SIGN_IN",
                      "SIGN_OUT",
                    ].includes(op),
                  },
                  ...(op === "RETURN" && r.kind === "DEPOSIT"
                    ? [
                        {
                          name: "amountMinor",
                          label: "Returned amount",
                          type: "money" as const,
                          required: true,
                        },
                      ]
                    : []),
                  {
                    name: "notes",
                    label:
                      op === "RETURN" && r.kind === "ASSIGNMENT"
                        ? "Return condition"
                        : "Notes / difference explanation",
                    type: "textarea",
                    required: op === "RETURN" && r.kind === "ASSIGNMENT",
                  },
                ]}
              />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
