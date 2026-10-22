import "server-only";
import type { Prisma } from "@prisma/client";
import { escapeHtml, renderNotificationEmail } from "@/lib/email/templates";
import { formatMoney } from "@/lib/format/money";
import { parseInvoiceItems } from "@/lib/finance/invoice";
import { invoiceTotals, lineSubtotalMinor } from "@/lib/finance/money";

// ───────────── Invoice email ─────────────

export function renderInvoiceEmail(invoice: {
  number: string;
  clientName: string;
  issuedOn: Date;
  dueOn: Date | null;
  currency: string;
  items: Prisma.JsonValue;
  totalMinor: number;
  notes: string | null;
  workspaceName: string;
  timeZone: string;
}) {
  const items = parseInvoiceItems(invoice.items);
  const totals = invoiceTotals(items);
  const money = (minor: number) => formatMoney(minor, invoice.currency);
  const day = (date: Date) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
  const rows = items
    .map((item) => `<tr><td style="padding:6px 0">${escapeHtml(item.description)}</td><td style="padding:6px 8px;text-align:right">${item.quantity}</td><td style="padding:6px 0;text-align:right">${escapeHtml(money(lineSubtotalMinor(item)))}</td></tr>`)
    .join("");
  const bodyHtml = [
    `<p>Hello ${escapeHtml(invoice.clientName)},</p>`,
    `<p>Here is invoice <strong>${escapeHtml(invoice.number)}</strong> from ${escapeHtml(invoice.workspaceName)}, issued ${escapeHtml(day(invoice.issuedOn))}${invoice.dueOn ? `, due ${escapeHtml(day(invoice.dueOn))}` : ""}.</p>`,
    `<table style="width:100%;border-collapse:collapse"><thead><tr><th scope="col" style="text-align:left">Item</th><th scope="col" style="text-align:right;padding:0 8px">Qty</th><th scope="col" style="text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`,
    totals.taxMinor ? `<p>Subtotal ${escapeHtml(money(totals.subtotalMinor))} · Tax ${escapeHtml(money(totals.taxMinor))}</p>` : "",
    `<p><strong>Total due: ${escapeHtml(money(totals.totalMinor))}</strong></p>`,
    invoice.notes ? `<p>${escapeHtml(invoice.notes).replace(/\n/g, "<br>")}</p>` : "",
  ].join("");
  const subject = `Invoice ${invoice.number} from ${invoice.workspaceName}`;
  const rendered = renderNotificationEmail({ title: subject, bodyHtml });
  const text = [
    `Hello ${invoice.clientName},`,
    "",
    `Here is invoice ${invoice.number} from ${invoice.workspaceName}, issued ${day(invoice.issuedOn)}${invoice.dueOn ? `, due ${day(invoice.dueOn)}` : ""}.`,
    "",
    ...items.map((item) => `- ${item.description} × ${item.quantity}: ${money(lineSubtotalMinor(item))}`),
    "",
    ...(totals.taxMinor ? [`Subtotal ${money(totals.subtotalMinor)} · Tax ${money(totals.taxMinor)}`] : []),
    `Total due: ${money(totals.totalMinor)}`,
    ...(invoice.notes ? ["", invoice.notes] : []),
  ].join("\n");
  return { subject, html: rendered.html, text };
}
