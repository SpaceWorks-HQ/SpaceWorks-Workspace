// Generated from app/a/[tag]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/permissions";
import { prisma } from "@/lib/db";

export async function loadAssetLabel({ params }: PageProps<"/a/[tag]">) {
const { tag } = await params;
if (!/^[a-zA-Z0-9_-]{1,64}$/.test(tag)) notFound();
const user = await getCurrentUser();
if (!user) redirect(`/login?callbackUrl=${encodeURIComponent(`/a/${tag}`)}`);
const asset = await prisma.asset.findFirst({ where: { tag, workspace: { archivedAt: null, memberships: { some: { userId: user.id, status: "ACTIVE", role: { in: ["MEMBER", "ADMIN", "OWNER"] } } } } }, select: { id: true, workspace: { select: { slug: true } } } });
if (!asset) notFound();
redirect(`/w/${asset.workspace.slug}/assets#${asset.id}`);

}
