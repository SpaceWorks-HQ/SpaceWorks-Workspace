import type { Metadata } from "next";
import Link from "next/link";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { AdminMfaForm } from "@/components/admin/AdminMfaForm";
import { Callout } from "@/components/ui/display";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/permissions";

export const metadata: Metadata = { title: "Confirm it's you" };

/** Fresh TOTP step-up before the instance admin area (valid for 10 minutes). */
export default async function AdminMfaPage() {
  const session = await requireSuperAdmin();
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { mfaEnabledAt: true } });
  return (
    <AuthFrame title="Confirm it's you." description="Instance admin needs a fresh code from your authenticator app.">
      {user?.mfaEnabledAt ? (
        <AdminMfaForm />
      ) : (
        <Callout tone="warning" title="Two-step verification is off">
          Turn it on in <Link href="/account" className="font-semibold underline underline-offset-4">your account</Link>, then come back.
        </Callout>
      )}
    </AuthFrame>
  );
}
