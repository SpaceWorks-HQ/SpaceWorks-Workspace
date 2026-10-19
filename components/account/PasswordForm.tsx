"use client";

import { useState, useTransition } from "react";
import { signOut } from "next-auth/react";
import { changePassword } from "@/app/actions/account";
import { Button } from "@/components/ui/button";
import { Field, PasswordInput } from "@/components/ui/field";
import { useToast } from "@/components/feedback/ToastProvider";

export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const { showToast } = useToast();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await changePassword({ currentPassword, newPassword });
          if (!result.ok) {
            setErrors(result.fieldErrors ?? {});
            showToast(result.error, "error");
            return;
          }
          showToast("Password updated. Sign in again with the new one.", "success");
          await signOut({ callbackUrl: "/login" });
        });
      }}
    >
      {hasPassword ? (
        <Field label="Current password" required error={errors.currentPassword?.[0]}>
          <PasswordInput value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" maxLength={128} />
        </Field>
      ) : null}
      <Field label="New password" required helperText="At least 12 characters. You'll be signed out everywhere." error={errors.newPassword?.[0]}>
        <PasswordInput value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" minLength={12} maxLength={128} />
      </Field>
      <Button type="submit" variant="primary" loading={pending} className="self-start">{hasPassword ? "Change password" : "Set password"}</Button>
    </form>
  );
}
