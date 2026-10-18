import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { bearerSecretMatches } from "@/lib/bearerSecret";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** Readiness for monitors: `Authorization: Bearer $HEALTHCHECK_SECRET`. Unauthorised callers get a plain 404. */
export async function GET(request: Request) {
  if (!bearerSecretMatches(request.headers.get("authorization"), process.env.HEALTHCHECK_SECRET)) {
    return new NextResponse("Not found", { status: 404, headers: privateHeaders });
  }
  try {
    // Deliberately no database identity, version or connection details.
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ ok: true, time: new Date().toISOString() }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: privateHeaders });
  }
}
