import { NextRequest } from "next/server";
import { issueDeviceCode } from "@/lib/secrets/device";
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
    const data = await issueDeviceCode(await jsonBody(request));
    const base = new URL(process.env.NEXT_PUBLIC_BASE_URL ?? request.url);
    return Response.json(
      {
        ...data,
        verification_uri: new URL("/device", base).href,
        verification_uri_complete: new URL(
          `/device?code=${data.user_code}`,
          base,
        ).href,
      },
      { headers: privateHeaders },
    );
  } catch (error) {
    return apiError(error);
  }
}
