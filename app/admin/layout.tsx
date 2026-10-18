import type { Metadata } from "next";
import { SimpleShell } from "@/components/chrome/SimpleShell";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { requireSuperAdminMfa } from "@/lib/permissions";

export const metadata: Metadata = { title: { default: "Instance admin", template: "%s · Instance admin" } };

/** Checked here for the chrome; every page also calls requireSuperAdminMfa() itself. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireSuperAdminMfa();
  return <SimpleShell nav={<AdminTabs />}>{children}</SimpleShell>;
}
