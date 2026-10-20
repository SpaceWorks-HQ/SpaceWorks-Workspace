// Generated from app/reset-password/[token]/page.tsx; regenerate with npm run frontend:catalog.
import "server-only";
import { viewDto } from "@/lib/frontend/view";
import { prisma } from "@/lib/db";
import { hashPasswordResetToken, isPlausibleResetToken } from "@/lib/passwordResetToken";

export async function loadResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
const { token } = await params;
const valid = isPlausibleResetToken(token)
    && Boolean(await prisma.passwordResetToken.findFirst({ where: { tokenHash: hashPasswordResetToken(token), usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } }));
return viewDto({ valid } as const);
}
