"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

export function SignOutButton({ label = "Sign out" }: { label?: string }) {
  return <Button variant="secondary" onClick={() => void signOut({ callbackUrl: "/login" })}>{label}</Button>;
}
