import { NextRequest } from "next/server";
import { pollDeviceCode } from "@/lib/secrets/device";
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
    await apiLimit(request);
    const body = await jsonBody(request);
    const data = await pollDeviceCode(String(body.device_code ?? ""));
    return Response.json(data, {
      status: "error" in data ? 400 : 200,
      headers: privateHeaders,
    });
  } catch (error) {
    return apiError(error);
  }
}
