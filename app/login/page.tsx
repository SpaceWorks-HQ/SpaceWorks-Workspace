import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { LoginForm } from "@/components/auth/LoginForm";
import { getGoogleSsoSettings } from "@/lib/instanceSettings";
import { getCurrentUser } from "@/lib/permissions";
import { isSetupOpen } from "@/lib/setup";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await isSetupOpen()) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const googleEnabled = Boolean(await getGoogleSsoSettings().catch(() => null));
  return (
    <AuthFrame title="Welcome back." description="Sign in to your community workspace.">
      <Suspense fallback={<p className="text-body-ui text-ink-muted">Loading sign in…</p>}>
        <LoginForm googleEnabled={googleEnabled} />
      </Suspense>
    </AuthFrame>
  );
}
