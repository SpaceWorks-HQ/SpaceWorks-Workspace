import type { WorkspaceRole } from "@prisma/client";
import { canViewFinance, hasRoleAtLeast } from "@/lib/roles";

/**
 * The single navigation config for the workspace sidebar (text-only, grouped).
 * Every product area lives here once; pages still enforce their own access
 * with `requireWorkspace(slug, minRole)`. Hiding a link is not authorization.
 */
export type NavRequirement = "finance" | "blog";

export type NavItemConfig = {
  key: string;
  label: string;
  /** Path below /w/<slug>; "" is the workspace home. */
  path: string;
  minRole: WorkspaceRole;
  requires?: NavRequirement;
  /** Match only the exact path (default: the path and anything below it). */
  exact?: boolean;
};

export type NavGroupConfig = { key: string; label: string | null; items: NavItemConfig[] };

export const NAV_GROUPS: readonly NavGroupConfig[] = [
  { key: "home", label: null, items: [{ key: "home", label: "Home", path: "", minRole: "GUEST", exact: true }] },
  {
    key: "community",
    label: "Community",
    items: [
      { key: "announcements", label: "Announcements", path: "/announcements", minRole: "GUEST" },
      { key: "members", label: "Members", path: "/members", minRole: "GUEST" },
      { key: "shoutouts", label: "Shoutouts", path: "/shoutouts", minRole: "GUEST" },
      { key: "calendar", label: "Calendar", path: "/calendar", minRole: "GUEST" },
    ],
  },
  {
    key: "work",
    label: "Work",
    items: [
      { key: "projects", label: "Projects", path: "/projects", minRole: "GUEST" },
      { key: "my-tasks", label: "My tasks", path: "/my-tasks", minRole: "MEMBER" },
      { key: "docs", label: "Docs", path: "/docs", minRole: "GUEST" },
      { key: "files", label: "Files", path: "/files", minRole: "GUEST" },
    ],
  },
  {
    key: "chat",
    label: "Chat",
    items: [
      { key: "channels", label: "Channels", path: "/chat", minRole: "GUEST" },
      { key: "dms", label: "Direct messages", path: "/dm", minRole: "MEMBER" },
    ],
  },
  {
    key: "operations",
    label: "Operations",
    items: [
      { key: "finance", label: "Finance", path: "/finance", minRole: "MEMBER", requires: "finance" },
      { key: "blog", label: "Blog", path: "/blog", minRole: "ADMIN" },
      { key: "seo", label: "SEO", path: "/seo", minRole: "ADMIN" },
    ],
  },
  {
    key: "assistant",
    label: "Assistant",
    items: [
      { key: "assistant", label: "Assistant", path: "/assistant", minRole: "MEMBER" },
      { key: "boardroom", label: "Boardroom", path: "/boardroom", minRole: "MEMBER" },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { key: "settings", label: "Workspace", path: "/settings", minRole: "ADMIN" },
      { key: "integrations", label: "Integrations", path: "/settings/integrations", minRole: "ADMIN" },
    ],
  },
];

export type NavContext = {
  role: WorkspaceRole;
  workspace: { financeVisibleToMembers: boolean; blogEnabled: boolean };
};

export type ResolvedNavItem = { key: string; label: string; href: string; exact: boolean };
export type ResolvedNavGroup = { key: string; label: string | null; items: ResolvedNavItem[] };

export function workspaceBasePath(slug: string) {
  return `/w/${encodeURIComponent(slug)}`;
}

function allowed(item: NavItemConfig, context: NavContext) {
  if (!hasRoleAtLeast(context.role, item.minRole)) return false;
  if (item.requires === "finance") return canViewFinance({ role: context.role }, context.workspace);
  return true;
}

/** Groups and links visible to a member, with hrefs for this workspace. Empty groups are dropped. */
export function navForMember(slug: string, context: NavContext): ResolvedNavGroup[] {
  const base = workspaceBasePath(slug);
  return NAV_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
    items: group.items
      .filter((item) => allowed(item, context))
      .map((item) => ({ key: item.key, label: item.label, href: `${base}${item.path}`, exact: Boolean(item.exact) })),
  })).filter((group) => group.items.length > 0);
}

/** Is `pathname` the active page for `item`? The longest matching href wins (see `activeNavKey`). */
export function navItemMatches(item: ResolvedNavItem, pathname: string) {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Key of the single active item: the most specific match (so /settings/integrations beats /settings). */
export function activeNavKey(groups: ResolvedNavGroup[], pathname: string): string | null {
  let best: ResolvedNavItem | null = null;
  for (const item of groups.flatMap((group) => group.items)) {
    if (navItemMatches(item, pathname) && (!best || item.href.length > best.href.length)) best = item;
  }
  return best?.key ?? null;
}
