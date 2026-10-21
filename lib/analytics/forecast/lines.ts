import "server-only";
import { day, addDays, addMonths, safeNumber } from "../metrics";
import { nextDue, taxAmounts } from "@/lib/finance/recurring/rules";
import { object } from "@/lib/funding/analytics";
import { AnalyticsError } from "../access";
import type { ForecastLine } from "../types";
import type { forecastSources } from "./sources";

export function forecastLines(
  sources: Awaited<ReturnType<typeof forecastSources>>,
  today: string,
  start: string,
  end: string,
  base: string,
) {
  const {
    bills,
    schedules,
    dues,
    pay,
    funding,
    adjustments,
    disbursements,
    receivables,
  } = sources;
  const projectionWarnings: string[] = [];
  const lines: ForecastLine[] = [],
    date = (v: Date | null) => (v && day(v) > today ? day(v) : start);
  for (const b of bills)
    lines.push({
      id: b.id,
      title: b.privatePayroll ? "Statutory payroll remittance" : b.vendor,
      date: date(b.dueOn),
      amountMinor: -(b.amountMinor - b.paidMinor),
      source: "Supplier bill",
      path: `${base}/finance/${b.privatePayroll ? "payroll/dues" : `bills?record=${b.id}`}`,
      estimated: b.needsActual,
    });
  const generated = new Set(dues.map((d) => `${d.scheduleId}:${day(d.dueOn)}`));
  for (const s of schedules) {
    let due = day(s.nextDueOn),
      n = 0;
    while (
      due < end &&
      (!s.endsOn || due <= day(s.endsOn)) &&
      (s.kind !== "EMI" || s._count.dues + n < s.tenure)
    ) {
      if (n >= 120) {
        projectionWarnings.push(
          `Forecast incomplete: recurring cost “${s.title}” exceeds the projection limit. Review its overdue schedule before relying on closing cash.`,
        );
        break;
      }
      n++;
      if (!generated.has(`${s.id}:${due}`))
        lines.push({
          id: `${s.id}:${due}`,
          title: s.title,
          date: due > today ? due : start,
          amountMinor: -taxAmounts(s.amountMinor, s.gstPercent, s.tdsPercent)
            .cashMinor,
          source: "Projected recurring cost",
          path: `${base}/finance/recurring?edit=${s.id}`,
          estimated: true,
        });
      const next = day(
        nextDue(
          new Date(due),
          s.frequency as "MONTHLY" | "QUARTERLY" | "YEARLY",
          s.dueDay,
        ),
      );
      if (next <= due) {
        projectionWarnings.push(
          `Forecast incomplete: recurring cost “${s.title}” could not advance. Review its schedule before relying on closing cash.`,
        );
        break;
      }
      due = next;
    }
  }
  for (const r of pay) {
    const due = `${r.month}-28`;
    if (due < end)
      lines.push({
        id: r.id,
        title: "Planned payroll",
        date: due > today ? due : start,
        amountMinor: -r.netMinor,
        source: "Payroll estimate",
        path: `${base}/finance/payroll?month=${r.month}#${r.id}`,
        estimated: true,
      });
  }
  for (const f of funding) {
    if (f.kind === "INSTALMENT" && f.status === "EXPECTED") {
      const when = date(f.dueOn);
      if (when < end)
        lines.push({
          id: f.id,
          title: f.title,
          date: when,
          amountMinor: f.amountMinor,
          source: "Grant instalment",
          path: `${base}/funding/grants?edit=${f.id}`,
          estimated: true,
        });
    }
    if (f.kind === "PLEDGE" && f.status === "ACTIVE") {
      const d = object(f.details),
        anchor = String(d.nextExpectedOn ?? ""),
        months = d.frequency === "YEARLY" ? 12 : d.frequency === "QUARTERLY" ? 3 : 1,
        paid = funding
          .filter(
            (g) =>
              g.kind === "DONATION" &&
              g.status === "RECEIVED" &&
              g.currency === f.currency &&
              object(g.details).pledgeId === f.id &&
              object(g.details).mode !== "IN_KIND",
          )
          .reduce((sum, g) => sum + g.amountMinor, 0);
      if (!anchor || f.amountMinor <= 0) continue;
      const once = d.frequency === "ONCE",
        firstUnpaid = Math.floor(paid / f.amountMinor),
        remainder = paid % f.amountMinor;
      // Calculate from the original anchor so month-end dates never drift.
      // Only one day comparison is needed after the arithmetic month jump.
      const indexAt = (on: string) => {
        const monthDistance =
          (Number(on.slice(0, 4)) - Number(anchor.slice(0, 4))) * 12 +
          Number(on.slice(5, 7)) - Number(anchor.slice(5, 7));
        const index = Math.max(0, Math.floor(monthDistance / months));
        return index + (addMonths(anchor, index * months) < on ? 1 : 0);
      };
      const stop = Math.min(
        indexAt(end),
        d.endOn ? indexAt(addDays(String(d.endOn), 1)) : Infinity,
        once ? 1 : Infinity,
      );
      const futureStart = indexAt(start),
        overdueEnd = Math.min(futureStart, stop);
      const push = (id: string, when: string, amount: number, overdue = false) =>
        lines.push({
          id: `${f.id}:${id}`,
          title: overdue ? `${f.title} · Overdue instalments` : f.title,
          date: when,
          amountMinor: amount,
          source: "Pledge estimate",
          path: `${base}/funding/donations?edit=${f.id}`,
          estimated: true,
        });
      if (overdueEnd > firstUnpaid)
        push("overdue", start, (overdueEnd - firstUnpaid) * f.amountMinor - remainder, true);
      // Past instalments cannot consume the future projection budget.
      let index = Math.max(firstUnpaid, futureStart),
        n = 0;
      for (; index < stop && n < 24; index++, n++) {
        const due = addMonths(anchor, index * months);
        push(due, due, f.amountMinor - (index === firstUnpaid ? remainder : 0));
      }
      if (index < stop)
        projectionWarnings.push(
          `Forecast incomplete: pledge “${f.title}” exceeds the projection limit. Review its dates before relying on closing cash.`,
        );
    }
  }
  for (const r of disbursements)
    lines.push({
      id: r.id,
      title: r.payee,
      date: date(r.dueOn),
      amountMinor: -r.amountMinor,
      source: "Approved disbursement",
      path: `${base}/finance/disbursements?record=${r.id}#${r.id}`,
      estimated: true,
    });
  for (const r of receivables)
    lines.push({
      id: r.id,
      title: r.title,
      date: date(r.date),
      amountMinor: safeNumber(r.value),
      source: "Receivable estimate",
      path: `${base}${r.path}`,
      estimated: true,
    });
  for (const r of adjustments)
    lines.push({
      id: r.id,
      title: r.title,
      date: day(r.dueOn),
      amountMinor: r.amountMinor,
      source: "Manual one-off",
      path: `${base}/analytics?section=finance#adjustments`,
      estimated: true,
    });
  if (lines.length > 10000)
    throw new AnalyticsError(
      "The forecast has more than 10,000 lines. Review overdue items and inactive schedules, or choose another currency.",
    );
  lines.sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  return { lines, projectionWarnings };
}
