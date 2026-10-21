import type { DocumentSnapshot } from "@/lib/documents/service";
import { formatMoney } from "@/lib/format/money";

export function FrozenIssueRecord({
  snapshot,
  currency,
}: {
  snapshot: DocumentSnapshot;
  currency: string;
}) {
  return (
    <section className="space-y-4 rounded-xl border border-line bg-panel p-5">
      <h2 className="text-h3">Frozen issue record</h2>
      <p>
        {String(snapshot.identity.name)} → {snapshot.input.partyName}
      </p>
      <p>{snapshot.input.partyAddress}</p>
      {snapshot.letter ? (
        <p className="whitespace-pre-wrap">{snapshot.letter}</p>
      ) : (
        snapshot.calculation.rows.map((l, i) => (
          <p key={i}>
            {l.description} · {l.quantity} ×{" "}
            {formatMoney(l.unitMinor, currency)} · Taxable{" "}
            {formatMoney(l.taxableMinor, currency)}
          </p>
        ))
      )}
      <p className="font-semibold">
        Total {formatMoney(snapshot.calculation.totalMinor, currency)}
      </p>
      <p>
        CGST {formatMoney(snapshot.calculation.cgstMinor, currency)} ·
        SGST/UTGST{" "}
        {formatMoney(snapshot.calculation.sgstMinor, currency)} · IGST{" "}
        {formatMoney(snapshot.calculation.igstMinor, currency)} · Cess{" "}
        {formatMoney(snapshot.calculation.cessMinor, currency)}
      </p>
      <p className="text-caption text-ink-muted">
        Template {snapshot.templateVersion}. Identity, wording and
        calculations are frozen.
      </p>
    </section>
  );
}
