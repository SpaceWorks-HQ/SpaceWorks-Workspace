import { NextRequest } from "next/server";
import { getClientIp } from "@/lib/rateLimit";
import { identityToken } from "@/lib/secrets/identities";
import { apiLimit, apiError, secureHost, privateHeaders } from "@/lib/secrets/http";
import { SecretsError } from "@/lib/secrets/values";
export async function POST(request: NextRequest) {
  try {
    secureHost(request);
    const raw = request.headers.get("authorization")?.match(/^Bearer (swwu_[A-Za-z0-9_-]{43})$/)?.[1] ?? "";
    await apiLimit(request, true, raw);
    const result = await identityToken(raw, getClientIp(request), undefined, true);
    if (!result || !("accessToken" in result)) throw new SecretsError("This token cannot be renewed. Sign in again.");
    return Response.json(result, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
