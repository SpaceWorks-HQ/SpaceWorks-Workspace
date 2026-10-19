import { Parser } from "htmlparser2";
export type AuditFinding = { check: string; passed: boolean; message: string };
export function auditHtml(html: string, pageUrl: string) {
  let title = ""; let titleDepth = false; let description = ""; let canonical = ""; let viewport = false; let lang = ""; let robots = ""; let h1 = 0; let images = 0; let missingAlt = 0;
  const parser = new Parser({ onopentag(name, attrs) { if (name === "title") titleDepth = true; if (name === "html") lang = attrs.lang ?? ""; if (name === "h1") h1++; if (name === "img") { images++; if (attrs.alt === undefined) missingAlt++; } if (name === "meta") { const key = (attrs.name ?? "").toLowerCase(); if (key === "description") description = attrs.content ?? ""; if (key === "viewport") viewport = true; if (key === "robots") robots = attrs.content ?? ""; } if (name === "link" && (attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical")) canonical = attrs.href ?? ""; }, ontext(text) { if (titleDepth) title += text; }, onclosetag(name) { if (name === "title") titleDepth = false; } }, { decodeEntities: true });
  parser.end(html);
  const findings: AuditFinding[] = [];
  const check = (name: string, passed: boolean, good: string, bad: string) => findings.push({ check: name, passed, message: passed ? good : bad });
  check("title", title.trim().length >= 10 && title.trim().length <= 60, "Title has a useful length.", "Add a descriptive title of 10–60 characters.");
  check("description", description.length >= 50 && description.length <= 160, "Description has a useful length.", "Add a meta description of 50–160 characters.");
  check("heading", h1 === 1, "One main heading.", "Use one H1 heading that describes the page.");
  check("language", Boolean(lang.trim()), "Page language is declared.", "Declare the page language on the HTML element.");
  check("viewport", viewport, "Mobile viewport is declared.", "Add a viewport meta tag for mobile devices.");
  check("alt", missingAlt === 0, `${images} images checked for alt attributes.`, `Add alt attributes to ${missingAlt} images; use empty alt for decoration.`);
  let validCanonical = false; try { const url = new URL(canonical, pageUrl); validCanonical = Boolean(canonical) && ["https:", "http:"].includes(url.protocol); } catch { /* Invalid URL */ }
  check("canonical", validCanonical, "Canonical URL is declared.", "Add a valid canonical URL.");
  check("indexable", !/\bnoindex\b/i.test(robots), "Page does not request noindex.", "This page requests noindex. Remove it if the page should appear in search.");
  check("https", new URL(pageUrl).protocol === "https:", "Page uses HTTPS.", "Serve the page over HTTPS.");
  return { score: Math.round(findings.filter(f => f.passed).length / findings.length * 100), findings };
}

export function belongsToProperty(property: string, pageUrl: string) {
  try {
    const page = new URL(pageUrl);
    if (!["http:", "https:"].includes(page.protocol) || page.username || page.password) return false;
    if (property.startsWith("sc-domain:")) {
      const domain = property.slice(10).toLowerCase();
      return page.hostname === domain || page.hostname.endsWith(`.${domain}`);
    }
    const root = new URL(property);
    return page.origin === root.origin && page.pathname.startsWith(root.pathname);
  } catch { return false; }
}
