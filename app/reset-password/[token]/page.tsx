import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { Callout } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { hashPasswordResetToken, isPlausibleResetToken } from "@/lib/passwordResetToken";

export const metadata: Metadata = { title: "Choose a new password", referrer: "no-referrer" };

export default async function ResetPasswordPage({ params }: PageProps<"/reset-password/[token]">) {
  const { token } = await params;
  const valid = isPlausibleResetToken(token)
    && Boolean(await prisma.passwordResetToken.findFirst({ where: { tokenHash: hashPasswordResetToken(token), usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } }));
  return (
    <AuthFrame centered title="Choose a new password." description={valid ? "Signing in with the new password signs you out everywhere else." : undefined}>
      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Callout tone="warning" title="This link has expired or was already used">
          <Link href="/forgot-password" className="font-semibold underline underline-offset-4">Ask for a new reset link.</Link>
        </Callout>
      )}
    </AuthFrame>
  );
}
