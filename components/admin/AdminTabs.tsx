"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/settings", label: "Instance settings" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/sso", label: "SSO" },
  { href: "/admin/backups", label: "Backups" },
  { href: "/admin/jobs", label: "Jobs" },
  { href: "/admin/outbox", label: "Email outbox" },
];

export function AdminTabs() {
  const pathname = usePathname() ?? "";
  return <NavTabs label="Instance admin" items={TABS.map((tab) => ({ ...tab, active: tab.href === "/admin" ? pathname === "/admin" : pathname.startsWith(tab.href) }))} />;
}
