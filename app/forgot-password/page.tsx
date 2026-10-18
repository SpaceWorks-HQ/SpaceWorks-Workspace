import type { Metadata } from "next";
import { AuthFrame } from "@/components/chrome/AuthFrame";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthFrame title="Reset your password." description="Enter your account email and we'll send you a link to choose a new password.">
      <ForgotPasswordForm />
    </AuthFrame>
  );
}
