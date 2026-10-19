"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { safeAuthRedirect } from "@/lib/authRedirect";

const ERRORS: Record<string, string> = {
  not_invited: "There's no account for that Google email. Ask an admin for an invitation.",
  disabled: "This account is disabled. Contact your workspace admin.",
};

export function LoginForm({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = safeAuthRedirect(params.get("callbackUrl"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfaStep, setMfaStep] = useState(false);
  const [loading, setLoading] = useState<null | "credentials" | "google">(null);
  const [error, setError] = useState<string | null>(() => {
    const value = params.get("error");
    if (!value) return null;
    return ERRORS[value] ?? "Sign-in couldn't be completed. Try again.";
  });
  const resetDone = params.get("reset") === "1";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading("credentials");
    try {
      const result = await signIn("credentials", { email, password, totp: mfaStep ? code : undefined, redirect: false });
      if (!result || result.error) {
        if (result?.code === "mfa_required") {
          setMfaStep(true);
        } else {
          setError(mfaStep ? "That code didn't work. Check your authenticator app or use a recovery code." : "Wrong email or password. Try again or reset your password.");
        }
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Sign-in is unavailable right now. Refresh the page and try again.");
    } finally {
      setLoading(null);
    }
  }

  if (mfaStep) {
    return (
      <form className="flex flex-col gap-5" onSubmit={submit}>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-h3 text-ink">Two-step verification</h2>
          <p className="text-body-ui text-ink-secondary">Enter the six-digit code from your authenticator app, or one of your recovery codes.</p>
        </div>
        {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
        <Field label="Verification code" required>
          <Input autoFocus value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" inputMode="text" maxLength={32} />
        </Field>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={loading === "credentials"}>Verify and sign in</Button>
        <Button
          variant="quiet"
          className="self-center"
          onClick={() => {
            setMfaStep(false);
            setCode("");
            setError(null);
          }}
        >
          Use a different account
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {resetDone ? <Callout tone="success" role="status">Password updated. Sign in with your new password.</Callout> : null}
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      {googleEnabled ? (
        <>
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            loading={loading === "google"}
            onClick={() => {
              setError(null);
              setLoading("google");
              void signIn("google", { callbackUrl }).catch(() => {
                setLoading(null);
                setError("Google sign-in is unavailable right now. Use your email and password.");
              });
            }}
          >
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-sm text-ink-muted">
            <span aria-hidden className="h-px flex-1 bg-line" />
            or with email
            <span aria-hidden className="h-px flex-1 bg-line" />
          </div>
        </>
      ) : null}
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <Field label="Email" required>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <div className="relative">
          <Field label="Password" required>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={128} />
          </Field>
          <Link href="/forgot-password" className="absolute right-0 top-0 text-sm font-semibold text-ink-secondary underline underline-offset-4 hover:text-ink">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={loading === "credentials"} className="mt-1">Sign in</Button>
      </form>
      <p className="text-center text-sm text-ink-muted">Space Works is invite-only. Ask a workspace admin for an invitation.</p>
    </div>
  );
}
