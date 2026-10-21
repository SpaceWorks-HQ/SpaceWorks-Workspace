import Link from "next/link";
import { label } from "@/lib/documents/rules";
import { formatDayTime } from "@/lib/format/datetime";

export function DocumentAuditHistory({
  history,
  timezone,
}: {
  history: Array<{ id: string; action: string; createdAt: Date }>;
  timezone: string;
}) {
  return (
    <details className="rounded-xl border border-line bg-panel p-5">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">
        Audit history
      </summary>
      <ul>
        {history.map((h) => (
          <li key={h.id} className="py-2">
            {h.action.replace("documents.", "").replaceAll("_", " ")} ·{" "}
            {formatDayTime(h.createdAt, timezone)}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function DocumentCorrections({
  corrections,
  base,
}: {
  corrections: Array<{
    id: string;
    number: string | null;
    title: string;
    status: string;
  }>;
  base: string;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-h3">Corrections</h2>
      {corrections.map((c) => (
        <p key={c.id}>
          <Link className="underline" href={`${base}/${c.id}`}>
            {c.number ?? c.title}
          </Link>{" "}
          · {label(c.status)}
        </p>
      ))}
      <p>
        Create a new draft and link this document as the original to retain
        correction history.
      </p>
    </section>
  );
}
