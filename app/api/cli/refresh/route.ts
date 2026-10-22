import { NextRequest } from "next/server";
import { refreshCliToken } from "@/lib/secrets/device";
import {
  apiLimit,
  secureHost,
  jsonBody,
  privateHeaders,
  apiError,
} from "@/lib/secrets/http";
export async function POST(request: NextRequest) {
  try {
    secureHost(request);
    await apiLimit(request, true);
    const body = await jsonBody(request);
    return Response.json(
      await refreshCliToken(String(body.refresh_token ?? "")),
      { headers: privateHeaders },
    );
  } catch (error) {
    return apiError(error);
  }
}
