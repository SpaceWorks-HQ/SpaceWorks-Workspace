import Link from "next/link";
import {
  Card,
} from "@/components/ui/display";
import { buttonClasses } from "@/components/ui/button";
import type { ControlsView } from "@/lib/moneyControls/types";
import {
  LABELS,
  SECTIONS,
  type Kind,
} from "@/lib/moneyControls/rules";
import { controlFields } from "./fields";
import { ControlForm } from "./ControlForm";

export function ControlEditor({ view }: { view: ControlsView }) {
  const { actor, section, data, p, editing, newKind, today } = view;
  const base = `/w/${actor.workspace.slug}/money-controls`;
  const kind =
    editing?.kind ??
    (newKind && SECTIONS[section].includes(newKind as Kind)
      ? (newKind as Kind)
      : SECTIONS[section][0]);
  const mutable =
    editing &&
    (editing.status === "DRAFT" ||
      ["FLOAT", "ASSET_CATEGORY", "FUND_RULE"].includes(kind));
  const fields = controlFields(
    kind,
    p,
    actor.workspace.currency,
    today,
    editing,
  );
  return (
    <Card>
      <details
        open={Boolean(editing) || Boolean(newKind) || data.total === 0}
        id="record-editor"
      >
        <summary className="min-h-11 cursor-pointer text-title">
          {editing ? `${LABELS[kind]}: ${editing.title}` : "Add a record"}
        </summary>
        {data.manage ? (
          <>
            <nav
              aria-label="Choose record type"
              className="my-4 flex flex-wrap gap-2"
            >
              {SECTIONS[section].map((k) => (
                <Link
                  key={k}
                  href={`${base}/${section}?new=${k}#record-editor`}
                  aria-current={!editing && kind === k ? "page" : undefined}
                  className={buttonClasses({
                    variant: !editing && kind === k ? "secondary" : "quiet",
                  })}
                >
                  {LABELS[k]}
                </Link>
              ))}
            </nav>
            {!editing || mutable ? (
              <ControlForm
                key={`${editing?.id ?? "new"}:${kind}`}
                slug={actor.workspace.slug}
                fields={fields}
                hidden={{ kind, id: editing?.id ?? "" }}
                categories={kind === "FUND_RULE" ? p.categories : undefined}
                selected={
                  kind === "FUND_RULE"
                    ? ((editing?.details as { allowedCategoryIds?: string[] })
                        ?.allowedCategoryIds ?? [])
                    : []
                }
                label={
                  editing
                    ? "Save changes"
                    : `Save ${LABELS[kind].toLowerCase()}`
                }
              />
            ) : (
              <p className="mb-4 text-body-ui">
                This record is confirmed. Its facts and evidence history are
                retained below.
              </p>
            )}
            <p className="mt-4 text-caption text-ink-muted">
              Save a draft, attach its proof, then confirm it. Cash accounts
              are created in Finance → Month-end. A float is a target, not an
              extra cash opening balance.
            </p>
          </>
        ) : (
          <p className="text-body-ui">
            Your assignments and custodian handovers appear below.
          </p>
        )}
      </details>
    </Card>
  );
}
