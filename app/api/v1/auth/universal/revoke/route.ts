import { NextRequest } from "next/server";
import { getClientIp } from "@/lib/rateLimit";
import { revokeOwnIdentityToken } from "@/lib/secrets/identities";
import { apiLimit, apiError, secureHost, privateHeaders } from "@/lib/secrets/http";
export async function POST(request: NextRequest) {
  try {
    secureHost(request);
    const raw = request.headers.get("authorization")?.match(/^Bearer (swwu_[A-Za-z0-9_-]{43})$/)?.[1] ?? "";
    await apiLimit(request, true, raw);
    await revokeOwnIdentityToken(raw, getClientIp(request));
    return Response.json({ ok: true }, { headers: privateHeaders });
  } catch (error) { return apiError(error); }
}
