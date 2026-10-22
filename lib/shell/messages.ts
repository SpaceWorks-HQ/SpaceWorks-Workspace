/** Catalogues keep message keys stable as translations are added. */
export const en = {
  home: "My day",
  search: "Search workspace",
  notifications: "Notifications",
  pinned: "Pinned",
  skip: "Skip to content",
  close: "Close",
  switchWorkspace: "Switch workspace",
  workspaces: "Workspaces",
  account: "Account settings",
  admin: "Instance admin",
  light: "Light mode",
  dark: "Dark mode",
  signOut: "Sign out",
  navigation: "Workspace",
  openNavigation: "Open navigation menu",
  closeNavigation: "Close navigation menu",
  noResults: "No matches yet. Try a different word.",
  recent: "Recent searches",
  commands: "Quick commands",
  searching: "Searching…",
  createTask: "Create task",
  createDoc: "Create doc",
  theme: "Toggle theme",
  activity: "Activity",
  links: "Links",
  preferences: "Notification preferences",
} as const;
export type ShellMessage = keyof typeof en;
export type ShellCatalogue = { [Key in ShellMessage]: string };
export const catalogues: Record<string, ShellCatalogue> = {
  "en-IN": en,
  "en-GB": en,
};
export function shellMessage(locale: string, key: ShellMessage): string {
  return (catalogues[locale] ?? en)[key];
}
