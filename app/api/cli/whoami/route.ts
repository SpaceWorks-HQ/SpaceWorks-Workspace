import { NextRequest } from "next/server";
import { authenticateCliToken } from "@/lib/secrets/device";
import {
  apiLimit,
  secureHost,
  privateHeaders,
  apiError,
} from "@/lib/secrets/http";
import { SecretsError } from "@/lib/secrets/values";
export async function GET(request: NextRequest) {
  try {
    secureHost(request);
    await apiLimit(request);
    const session = await authenticateCliToken(
      request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
    );
    if (!session) throw new SecretsError("Sign in again.");
    return Response.json(
      {
        user: { id: session.userId, name: session.user.name },
        sessionId: session.id,
        scope: "secrets",
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return apiError(error);
  }
}
