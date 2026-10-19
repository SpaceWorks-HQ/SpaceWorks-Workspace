import "server-only";

import sanitizeHtml from "sanitize-html";

/**
 * Announcement bodies are rich text from the editor, stored as sanitised
 * HTML and sanitised again when rendered. Only the formatting the editor
 * offers survives: paragraphs, headings, emphasis, lists, quotes, code and
 * links (http, https, mailto; opened in a new tab without a referrer).
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "h2", "h3", "ul", "ol", "li", "blockquote", "a", "code", "pre", "hr"],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    h1: "h2",
    h4: "h3",
    h5: "h3",
    h6: "h3",
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...(attribs.href ? { href: attribs.href } : {}), target: "_blank", rel: "noopener noreferrer nofollow" },
    }),
  },
};

export const MAX_RICH_TEXT_LENGTH = 50_000;

export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html.slice(0, MAX_RICH_TEXT_LENGTH * 2), OPTIONS).trim();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Plain text for previews, search and notifications. */
export function richTextToPlain(html: string): string {
  const withBreaks = html.replace(/<(br|hr)\s*\/?>/gi, "\n").replace(/<\/(p|h2|h3|li|blockquote|pre)>/gi, "\n");
  const text = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return text
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export function excerpt(text: string, max = 240): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
