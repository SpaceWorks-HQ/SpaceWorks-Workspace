import { NextRequest } from "next/server";
import { consumeShare } from "@/lib/secrets/shares";
import {
  apiLimit,
  browserOrigin,
  jsonBody,
  privateHeaders,
  apiError,
} from "@/lib/secrets/http";
export async function POST(request: NextRequest) {
  try {
    browserOrigin(request);
    await apiLimit(request);
    const body = await jsonBody(request);
    return Response.json(
      { ciphertext: await consumeShare(String(body.capability ?? "")) },
      { headers: privateHeaders },
    );
  } catch (error) {
    return apiError(error);
  }
}
