import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateCliToken } from "@/lib/secrets/device";
import { verifyVaultMfa } from "@/lib/vault/mfa";
import { checkRateLimitById } from "@/lib/rateLimit";
import { recordAuditEvent } from "@/lib/audit";
import {
  apiLimit,
  secureHost,
  jsonBody,
  privateHeaders,
  apiError,
} from "@/lib/secrets/http";
import { SecretsError } from "@/lib/secrets/values";
export async function POST(request: NextRequest) {
  try {
    secureHost(request);
    await apiLimit(request, true);
    const session = await authenticateCliToken(
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
    );
    if (!session) throw new SecretsError("Sign in again.");
    if (
      !(await checkRateLimitById("auth", `secrets-cli-mfa:${session.userId}`))
    )
      throw new SecretsError("Too many attempts. Try again shortly.");
    const { code } = await jsonBody(request);
    if (typeof code !== "string" || !/^\d{6}$/.test(code))
      throw new SecretsError("Enter a six-digit authenticator code.");
    await verifyVaultMfa(session.userId, code);
    await prisma.cliSession.update({
      where: { id: session.id },
      data: { mfaAt: new Date() },
    });
    await recordAuditEvent({
      actorId: session.userId,
      action: "secrets.cli_mfa",
      targetId: session.id,
    });
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error);
  }
}
