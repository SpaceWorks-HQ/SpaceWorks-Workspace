"use client";

import { useState } from "react";
import Link from "next/link";
import { requestPasswordReset } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await requestPasswordReset({ email });
      if (!result.ok) setError(result.error);
      else setSent(true);
    } catch {
      setError("Couldn't send the email. Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-4">
        <Callout tone="success" role="status">If there&apos;s an account for {email}, a reset link is on its way. It expires in 1 hour.</Callout>
        <Link href="/login" className="text-sm font-semibold text-ink underline underline-offset-4">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form className="flex flex-col gap-4" onSubmit={submit}>
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <Field label="Email" required>
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </Field>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={loading}>Send reset link</Button>
      <Link href="/login" className="self-center text-sm text-ink-secondary underline-offset-4 hover:underline">Back to sign in</Link>
    </form>
  );
}
