const nonSlug = /[^a-z0-9]+/g;

/** "Build Night #4!" → "build-night-4". Falls back to `fallback` when nothing is left. */
export function slugify(value: string, fallback = "item"): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(nonSlug, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || fallback;
}

export function withSlugSuffix(base: string, suffix: number): string {
  return suffix === 0 ? base : `${base}-${suffix}`;
}

export const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;

/** Workspace slugs live under /w/<slug>; keep a few words free for future top-level use. */
export const RESERVED_WORKSPACE_SLUGS: ReadonlySet<string> = new Set(["new", "admin", "api", "settings", "account", "setup"]);

export function isValidWorkspaceSlug(slug: string) {
  return slugPattern.test(slug) && !RESERVED_WORKSPACE_SLUGS.has(slug);
}
