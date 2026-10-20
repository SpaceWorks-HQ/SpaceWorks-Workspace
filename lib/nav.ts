import type { WorkspaceRole } from "@prisma/client";
import { canViewFinance, hasRoleAtLeast } from "@/lib/roles";

/**
 * The single navigation config for the workspace sidebar (text-only, grouped).
 * Every product area lives here once; pages still enforce their own access
 * with `requireWorkspace(slug, minRole)`. Hiding a link is not authorization.
 */
export type NavRequirement = "finance";

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
  { key: "home", label: null, items: [{ key: "home", label: "Home", path: "", minRole: "GUEST", exact: true },
      { key: "search", label: "Search", path: "/search", minRole: "GUEST" },
      { key: "activity", label: "Activity", path: "/activity", minRole: "GUEST" },
      { key: "links", label: "Links", path: "/links", minRole: "GUEST" }] },
  {
    key: "people",
    label: "People",
    items: [
      { key: "announcements", label: "Announcements", path: "/announcements", minRole: "GUEST" },
      { key: "members", label: "Members", path: "/members", minRole: "GUEST" },
      { key: "teams", label: "Teams", path: "/teams", minRole: "GUEST" },
      { key: "my-onboarding", label: "Onboarding", path: "/onboarding", minRole: "GUEST" },
      { key: "changelog", label: "Changelog", path: "/changelog", minRole: "GUEST" },
      { key: "polls", label: "Polls", path: "/polls", minRole: "MEMBER" },
      { key: "ideas", label: "Ideas", path: "/ideas", minRole: "MEMBER" },
    ],
  },
  {
    key: "work",
    label: "Work",
    items: [
      { key: "projects", label: "Projects", path: "/projects", minRole: "GUEST" },
      { key: "my-tasks", label: "My tasks", path: "/my-tasks", minRole: "MEMBER" },
      { key: "notepad", label: "Notepad", path: "/notepad", minRole: "GUEST" },
      { key: "cycles", label: "Cycles", path: "/cycles", minRole: "MEMBER" },
      { key: "meetings", label: "Meetings", path: "/meetings", minRole: "GUEST" },
      { key: "decisions", label: "Decisions", path: "/meetings/decisions", minRole: "GUEST" },
      { key: "templates", label: "Templates", path: "/templates", minRole: "MEMBER" },
      { key: "sign-offs", label: "Sign-offs", path: "/sign", minRole: "GUEST" },
      { key: "goals", label: "Goals", path: "/goals", minRole: "MEMBER" },
      { key: "docs", label: "Docs", path: "/docs", minRole: "GUEST" },
      { key: "files", label: "Files", path: "/files", minRole: "GUEST" },
      { key: "forms", label: "Forms", path: "/forms", minRole: "MEMBER" },
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
      { key: "helpdesk", label: "Help desk", path: "/helpdesk", minRole: "MEMBER" },
      { key: "safety", label: "Safety & facilities", path: "/safety", minRole: "MEMBER" },
      { key: "leave", label: "Leave", path: "/leave", minRole: "MEMBER" },
      { key: "hiring", label: "Hiring", path: "/hiring", minRole: "ADMIN" },
      { key: "volunteering", label: "Hours", path: "/volunteering", minRole: "MEMBER" },
      { key: "social", label: "Social", path: "/social", minRole: "MEMBER" },
      { key: "governance", label: "Governance", path: "/governance", minRole: "ADMIN" },
      { key: "app-reviews", label: "App reviews", path: "/app-reviews", minRole: "MEMBER" },
      { key: "services", label: "Services", path: "/services", minRole: "MEMBER" },
      { key: "catalogue", label: "Service catalogue", path: "/catalogue", minRole: "MEMBER" },
      { key: "vault", label: "Vault", path: "/vault", minRole: "MEMBER" },
      { key: "contacts", label: "Contacts", path: "/contacts", minRole: "MEMBER" },
      { key: "organisations", label: "Organisations", path: "/contacts/organisations", minRole: "MEMBER" },
      { key: "pipeline", label: "Pipeline", path: "/contacts/pipeline", minRole: "MEMBER" },
      { key: "assets", label: "Assets", path: "/assets", minRole: "MEMBER" },
      { key: "requests", label: "Requests", path: "/requests", minRole: "MEMBER" },
      { key: "finance", label: "Finance", path: "/finance", minRole: "MEMBER", requires: "finance" },
      { key: "subscriptions", label: "Subscriptions", path: "/subscriptions", minRole: "MEMBER" },
      { key: "rota", label: "Rota", path: "/rota", minRole: "MEMBER" },
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
  { key: "personal", label: "Personal", items: [
      { key: "calendar-subscribe", label: "Personal calendar feed", path: "/calendar/subscribe", minRole: "GUEST" },
      { key: "notifications", label: "Notifications", path: "/notifications", minRole: "GUEST" },
      { key: "notification-preferences", label: "Notification preferences", path: "/notifications/preferences", minRole: "GUEST" },
      { key: "notification-accounts", label: "Connected accounts", path: "/notifications/accounts", minRole: "MEMBER" },
  ] },
  {
    key: "settings",
    label: "Settings",
    items: [
      { key: "settings", label: "Workspace", path: "/settings", minRole: "ADMIN" },
      { key: "notification-routing", label: "Notifications", path: "/settings/notifications", minRole: "ADMIN" },
      { key: "integrations", label: "Integrations", path: "/settings/integrations", minRole: "ADMIN" },
      { key: "webhooks", label: "Webhooks", path: "/settings/notifications#webhooks", minRole: "ADMIN" },
      { key: "messaging", label: "Messaging", path: "/settings/messaging", minRole: "ADMIN" },
      { key: "cloud-accounts", label: "Cloud accounts", path: "/settings/cloud-accounts", minRole: "ADMIN" },
      { key: "retention", label: "Retention", path: "/settings/retention", minRole: "ADMIN" },
      { key: "app-reviews-settings", label: "App review settings", path: "/app-reviews/settings", minRole: "ADMIN" },
      { key: "onboarding", label: "Onboarding templates", path: "/settings/onboarding", minRole: "ADMIN" },
    ],
  },
];

export type NavContext = {
  role: WorkspaceRole;
  workspace: { financeVisibleToMembers: boolean };
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
