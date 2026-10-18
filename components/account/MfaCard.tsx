"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { beginMfaEnrollment, confirmMfaEnrollment, disableMfa } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { Callout, Chip } from "@/components/ui/display";
import { Field, Input, PasswordInput } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";

type Step = { kind: "idle" } | { kind: "password" } | { kind: "scan"; secret: string; qrSvg: string } | { kind: "codes"; codes: string[] } | { kind: "disable" };

export function MfaCard({ enabled, remainingCodes }: { enabled: boolean; remainingCodes: number }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setStep({ kind: "idle" });
    setPassword("");
    setCode("");
    setError(null);
  };

  if (step.kind === "codes") {
    return (
      <div className="flex flex-col gap-4">
        <Callout tone="success" title="Two-step verification is on">Save these recovery codes somewhere safe. Each works once if you lose your phone. They won&apos;t be shown again.</Callout>
        <ul className="grid grid-cols-1 gap-2 whitespace-nowrap rounded-lg border border-line bg-surface p-4 text-body-ui tabular-nums text-ink min-[400px]:grid-cols-2">
          {step.codes.map((value) => <li key={value}>{value}</li>)}
        </ul>
        <Button variant="primary" className="self-start" onClick={() => { reset(); router.refresh(); }}>I&apos;ve saved them</Button>
      </div>
    );
  }

  if (enabled) {
    return (
      <div className="flex flex-col gap-4">
        <p className="flex flex-wrap items-center gap-2 text-body-ui text-ink-secondary">
          <Chip tone="success">On</Chip>
          You&apos;ll enter a code from your authenticator app when you sign in. {remainingCodes} recovery {remainingCodes === 1 ? "code" : "codes"} left.
        </p>
        {step.kind === "disable" ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await disableMfa({ code });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                showToast("Two-step verification is off. Sign in again.", "success");
                await signOut({ callbackUrl: "/login" });
              });
            }}
          >
            {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
            <Field label="Authenticator or recovery code" required>
              <Input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" maxLength={32} autoFocus />
            </Field>
            <span className="flex gap-2">
              <Button type="submit" variant="dangerSolid" loading={pending}>Turn off</Button>
              <Button variant="secondary" onClick={reset}>Cancel</Button>
            </span>
          </form>
        ) : (
          <Button variant="dangerOutline" className="self-start" onClick={() => setStep({ kind: "disable" })}>Turn off…</Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      {step.kind === "idle" ? (
        <>
          <p className="text-body-ui text-ink-secondary">Add a second step at sign-in with an authenticator app. Required for instance admins.</p>
          <Button variant="primary" className="self-start" onClick={() => setStep({ kind: "password" })}>Set up two-step verification</Button>
        </>
      ) : null}
      {step.kind === "password" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await beginMfaEnrollment({ password });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setStep({ kind: "scan", secret: result.data!.secret, qrSvg: result.data!.qrSvg });
            });
          }}
        >
          <Field label="Confirm your password" required>
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={128} autoFocus />
          </Field>
          <span className="flex gap-2">
            <Button type="submit" variant="primary" loading={pending}>Continue</Button>
            <Button variant="secondary" onClick={reset}>Cancel</Button>
          </span>
        </form>
      ) : null}
      {step.kind === "scan" ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await confirmMfaEnrollment({ code });
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setStep({ kind: "codes", codes: result.data!.recoveryCodes });
            });
          }}
        >
          <p className="text-body-ui text-ink-secondary">Scan this code with your authenticator app, then enter the six-digit code it shows.</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {/* Server-generated SVG from the qrcode library (no user content). */}
            <div className="size-44 shrink-0 rounded-lg border border-line bg-sw-cream p-2 [&_svg]:size-full" dangerouslySetInnerHTML={{ __html: step.qrSvg }} />
            <div className="min-w-0 text-caption text-ink-muted">
              Can&apos;t scan? Enter this key manually:
              <code className="mt-1 block break-all rounded-md bg-surface px-2 py-1.5 font-sans text-body-ui tabular-nums text-ink">{step.secret}</code>
            </div>
          </div>
          <Field label="Six-digit code" required>
            <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={12} autoFocus />
          </Field>
          <span className="flex gap-2">
            <Button type="submit" variant="primary" loading={pending}>Turn on</Button>
            <Button variant="secondary" onClick={reset}>Cancel</Button>
          </span>
        </form>
      ) : null}
    </div>
  );
}
