import { NextRequest } from "next/server";
import {
  authenticateCliToken,
  listCliSessions,
  revokeCliSession,
} from "@/lib/secrets/device";
import {
  apiLimit,
  secureHost,
  jsonBody,
  privateHeaders,
  apiError,
} from "@/lib/secrets/http";
import { SecretsError } from "@/lib/secrets/values";
async function session(request: NextRequest) {
  secureHost(request);
  await apiLimit(request, request.method !== "GET");
  const raw =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const row = await authenticateCliToken(raw);
  if (!row) throw new SecretsError("Sign in again.");
  return row;
}
export async function GET(request: NextRequest) {
  try {
    const row = await session(request);
    return Response.json(
      { sessions: await listCliSessions(row.userId) },
      { headers: privateHeaders },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: NextRequest) {
  try {
    const row = await session(request);
    const body = await jsonBody(request);
    await revokeCliSession(row.userId, String(body.id ?? row.id));
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) {
    return apiError(error);
  }
}
