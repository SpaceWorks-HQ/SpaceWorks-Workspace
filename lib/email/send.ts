import "server-only";

import { assertEmailAccepted, getEmailTransport } from "./transporter";
import type { RenderedEmail } from "./templates";

/** Send one rendered email. Without SMTP in development it is dropped with a log line (never the content). */
export async function sendRenderedEmail(to: string, email: RenderedEmail, messageId?: string) {
  const { transporter, from } = await getEmailTransport();
  if (!transporter) {
    console.log("[email] SMTP not configured; message dropped in development");
    return;
  }
  const result = await transporter.sendMail({ messageId, from, to, subject: email.subject, text: email.text, html: email.html });
  assertEmailAccepted(result);
}
