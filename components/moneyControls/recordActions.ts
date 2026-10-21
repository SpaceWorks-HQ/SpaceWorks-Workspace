import type { ControlsView } from "@/lib/moneyControls/types";
import {
  words,
} from "@/lib/moneyControls/rules";
import type { ControlRow } from "@/lib/moneyControls/types";

export function controlRecordActions(
  r: ControlRow,
  d: Record<string, unknown>,
  editable: boolean,
  draft: boolean,
  personalHandover: boolean,
  actor: ControlsView["actor"],
) {
  const actions: string[] = [];
  if (
    editable &&
    draft &&
    ![
      "FLOAT",
      "ASSET_CATEGORY",
      "FUND_RULE",
      "HANDOVER",
      "REPLENISHMENT",
    ].includes(r.kind)
  )
    actions.push("POST");
  if (
    editable &&
    r.kind === "REPLENISHMENT" &&
    ["DRAFT", "PENDING"].includes(r.status)
  )
    actions.push("REQUEST", ...(r.status === "PENDING" ? ["POST"] : []));
  if (
    personalHandover &&
    d.outgoingId === actor.user.id &&
    !d.signedOutAt
  )
    actions.push("SIGN_OUT");
  if (personalHandover && r.ownerId === actor.user.id && d.signedOutAt)
    actions.push("SIGN_IN");
  if (
    editable &&
    ((r.kind === "DEPOSIT" &&
      ["POSTED", "PARTLY_RETURNED"].includes(r.status)) ||
      (r.kind === "ASSIGNMENT" && r.status === "ASSIGNED"))
  )
    actions.push("RETURN");
  if (
    r.kind === "ASSIGNMENT" &&
    r.status === "ASSIGNED" &&
    r.ownerId === actor.user.id &&
    !d.acknowledgedAt
  )
    actions.push("ACKNOWLEDGE");
  if (
    editable &&
    r.kind === "FILING" &&
    ["PREPARED", "SUBMITTED", "ACCEPTED"].includes(r.status)
  )
    actions.push(
      r.status === "PREPARED"
        ? "SUBMITTED"
        : r.status === "SUBMITTED"
          ? "ACCEPTED"
          : "PAID",
    );
  if (editable && ["DRAFT", "PENDING"].includes(r.status))
    actions.push("CANCEL");
  const actionLabel = (op: string) =>
    ({
      POST:
        r.kind === "FILING"
          ? "Mark prepared"
          : r.kind === "REPLENISHMENT"
            ? "Record approved replenishment"
            : "Confirm record",
      REQUEST: "Request approval",
      RETURN:
        r.kind === "DEPOSIT"
          ? "Record deposit return"
          : "Return equipment",
      SIGN_IN: "Sign as incoming custodian",
      SIGN_OUT: "Sign as outgoing custodian",
      ACKNOWLEDGE: "Acknowledge receipt",
      CANCEL: "Cancel unconfirmed record",
    })[op] ?? `Mark ${words(op).toLowerCase()}`;
  return { actions, actionLabel };
}
