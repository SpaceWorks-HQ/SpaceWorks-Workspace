"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";

const TABS: { path: string; label: string; workspaceRoot?: boolean }[] = [
  { path: "", label: "General" },
  { path: "/members", label: "Members" },
  { path: "/invitations", label: "Invitations" },
  { path: "/labels", label: "Labels" },
  { path: "/api-tokens", label: "API tokens" },
  { path: "/notifications", label: "Notifications" },
  { path: "/integrations", label: "Integrations" },
  { path: "/notifications#webhooks", label: "Webhooks" },
  { path: "/messaging", label: "Messaging" },
  { path: "/cloud-accounts", label: "Cloud accounts" },
  { path: "/onboarding", label: "Onboarding" },
  { path: "/retention", label: "Retention" },
  { path: "/export", label: "Export" },
  { path: "/import", label: "Import" },
  { path: "/app-reviews/settings", label: "App reviews", workspaceRoot: true },
  { path: "/audit", label: "Audit log" },
];

export function SettingsTabs({ slug }: { slug: string }) {
  const pathname = usePathname() ?? "";
  const base = `/w/${slug}/settings`;
  return (
    <NavTabs
      label="Workspace settings"
      items={TABS.map((tab) => {
        const href = `${tab.workspaceRoot ? `/w/${slug}` : base}${tab.path}`;
        return { href, label: tab.label, active: tab.path === "" ? pathname === base : pathname.startsWith(href) };
      })}
    />
  );
}
