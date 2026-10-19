"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { verifyAdminMfa } from "@/app/actions/admin";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Field, Input } from "@/components/ui/field";

export function AdminMfaForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await verifyAdminMfa({ code });
          if (!result.ok) {
            setError(result.error);
            return;
          }
          router.push("/admin");
          router.refresh();
        });
      }}
    >
      {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
      <Field label="Authenticator code" required>
        <Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus />
      </Field>
      <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>Continue to admin</Button>
    </form>
  );
}
