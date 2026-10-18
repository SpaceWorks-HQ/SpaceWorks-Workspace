import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordAuditEvent } from "@/lib/audit";
import { buildAccountExport } from "@/lib/accountExport";
import { checkRateLimitById } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/** Download the signed-in member's own data as JSON. */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } }) : null;
  if (!userId || !user || user.disabledAt) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!(await checkRateLimitById("dataExport", `user:${userId}`))) {
    return new Response("Too many exports. Try again in an hour.", { status: 429, headers: { "Retry-After": "3600", "Cache-Control": "no-store" } });
  }
  const data = await buildAccountExport(userId);
  if (!data) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  await recordAuditEvent({ action: "account.data_exported", actorId: userId, targetType: "User", targetId: userId });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="space-works-account-${date}.json"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
