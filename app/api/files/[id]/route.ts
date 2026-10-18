import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { findDownloadableFile } from "@/lib/files";
import { fileResponse } from "@/lib/storage";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

/** Authorised download of a private workspace file. `?download=1` forces an attachment. */
export async function GET(request: Request, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return notFound();
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { disabledAt: true } });
  if (!user || user.disabledAt) return notFound();
  const file = await findDownloadableFile(id, userId);
  if (!file) return notFound();
  const download = new URL(request.url).searchParams.get("download") === "1";
  return fileResponse(file, { download });
}
