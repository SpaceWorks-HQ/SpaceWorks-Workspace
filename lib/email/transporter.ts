import "server-only";

import nodemailer from "nodemailer";
import { getEmailSettings } from "@/lib/instanceSettings";

const SMTP_CONNECTION_TIMEOUT_MS = 30_000;
const SMTP_GREETING_TIMEOUT_MS = 30_000;
const SMTP_SOCKET_TIMEOUT_MS = 60_000;

export class EmailTransportUnavailableError extends Error {
  override name = "EmailTransportUnavailableError";

  constructor() {
    super("Transactional email transport is not configured.");
  }
}

export class EmailRecipientRejectedError extends Error {
  override name = "EmailRecipientRejectedError";

  constructor() {
    super("SMTP rejected the recipient.");
  }
}

export function assertEmailAccepted(result: { accepted?: unknown; rejected?: unknown }) {
  if (
    (Array.isArray(result.rejected) && result.rejected.length > 0) ||
    (Array.isArray(result.accepted) && result.accepted.length === 0)
  ) {
    throw new EmailRecipientRejectedError();
  }
}

export async function getEmailTransport() {
  const settings = await getEmailSettings();
  const tls = process.env.NODE_ENV === "production" ? { minVersion: "TLSv1.2" as const, rejectUnauthorized: true } : undefined;
  const requireTLS = process.env.NODE_ENV === "production" && !settings.secure;
  if (settings.service) {
    return {
      from: settings.from,
      transporter: nodemailer.createTransport({
        service: settings.service, auth: settings.user && settings.password ? { user: settings.user, pass: settings.password } : undefined,
        disableFileAccess: true, disableUrlAccess: true, requireTLS, tls,
        connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
        greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
        socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
      }),
    };
  }
  if (!settings.host) {
    if (process.env.NODE_ENV === "production") throw new EmailTransportUnavailableError();
    return { from: settings.from, transporter: null };
  }
  return {
    from: settings.from,
    transporter: nodemailer.createTransport({
      host: settings.host, port: settings.port, secure: settings.secure,
      auth: settings.user && settings.password ? { user: settings.user, pass: settings.password } : undefined,
      disableFileAccess: true, disableUrlAccess: true, requireTLS, tls,
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    }),
  };
}
