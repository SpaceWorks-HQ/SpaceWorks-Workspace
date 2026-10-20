import { NextResponse } from "next/server";
import { enqueueDueOutbox } from "@/lib/queue/enqueue";
import { bearerSecretMatches } from "@/lib/bearerSecret";

export const dynamic = "force-dynamic";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/** External scheduler hook (`Authorization: Bearer $CRON_SECRET`) for hosts that sleep idle processes. */
export async function POST(request: Request) {
  if (!bearerSecretMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return new NextResponse("Not found", { status: 404, headers: privateHeaders });
  }
  try {
    const result = await enqueueDueOutbox();
    return NextResponse.json({ ok: true, ...result }, { headers: privateHeaders });
  } catch {
    return NextResponse.json({ ok: false, error: "Jobs could not be queued. Try again." }, { status: 503, headers: privateHeaders });
  }
}
