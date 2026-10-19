import sanitizeHtml from "sanitize-html";

/**
 * Server-side sanitiser for doc HTML. Every doc body, template and revision
 * is passed through `sanitizeDocHtml` before it is stored, and again before
 * it is rendered outside the editor. The allow-list matches what the doc
 * editor produces (StarterKit, task lists, tables, images, mentions) so an
 * editor round trip is lossless, and nothing else survives: no scripts,
 * styles, event handlers, iframes or forms.
 *
 * Images may only point at the app's own authorised file route, so a doc can
 * never make a viewer's browser fetch an outside URL.
 */

export const MAX_DOC_HTML_LENGTH = 1_000_000;

const FILE_IMAGE_SRC = /^\/api\/files\/[A-Za-z0-9_-]{1,64}$/;
const LANGUAGE_CLASS = /^language-[A-Za-z0-9_+-]{1,40}$/;

const ALLOWED_TAGS = [
  "h1", "h2", "h3", "h4", "p", "br", "hr", "blockquote",
  "strong", "b", "em", "i", "s", "u", "code", "pre", "a", "span",
  "ul", "ol", "li", "label", "input", "div",
  "table", "colgroup", "col", "thead", "tbody", "tr", "th", "td",
  "img",
];

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    ol: ["start", "type"],
    ul: ["data-type"],
    li: ["data-type", "data-checked"],
    input: ["type", "checked", "disabled"],
    span: ["data-type", "data-id", "data-label", "class"],
    code: ["class"],
    th: ["colspan", "rowspan", "colwidth"],
    td: ["colspan", "rowspan", "colwidth"],
    img: ["src", "alt", "title"],
  },
  allowedClasses: { code: [LANGUAGE_CLASS], span: ["mention"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: { img: [] },
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  // Unknown or unsafe wrappers keep their text, but script-like content is dropped entirely.
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "iframe", "object", "embed", "svg", "math", "template"],
  transformTags: {
    b: "strong",
    i: "em",
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const raw = (attribs.href ?? "").trim();
      const internal = raw.startsWith("/") && !raw.startsWith("//");
      const href = internal || /^(https?:\/\/|mailto:)/i.test(raw) ? raw : "";
      return {
        tagName,
        attribs: {
          ...(href ? { href } : {}),
          ...(attribs.title ? { title: attribs.title } : {}),
          ...(internal || !href ? {} : { target: "_blank", rel: "noopener noreferrer nofollow" }),
        },
      };
    },
    // Only task-list checkboxes survive; any other input becomes an unknown tag and is dropped.
    input: (tagName, attribs): sanitizeHtml.Tag =>
      attribs.type === "checkbox"
        ? { tagName, attribs: { type: "checkbox", ...(attribs.checked !== undefined ? { checked: "checked" } : {}), disabled: "disabled" } }
        : { tagName: "dropped-input", attribs: {} },
    li: (tagName, attribs): sanitizeHtml.Tag => {
      if (attribs["data-type"] !== "taskItem") return { tagName, attribs: {} };
      return { tagName, attribs: { "data-type": "taskItem", "data-checked": attribs["data-checked"] === "true" || attribs["data-checked"] === "" ? "true" : "false" } };
    },
    ul: (tagName, attribs): sanitizeHtml.Tag => ({ tagName, attribs: attribs["data-type"] === "taskList" ? { "data-type": "taskList" } : {} }),
    span: (tagName, attribs): sanitizeHtml.Tag => {
      if (attribs["data-type"] !== "mention" || !/^[A-Za-z0-9_-]{1,64}$/.test(attribs["data-id"] ?? "")) return { tagName, attribs: {} };
      return {
        tagName,
        attribs: { "data-type": "mention", "data-id": attribs["data-id"]!, ...(attribs["data-label"] ? { "data-label": attribs["data-label"].slice(0, 120) } : {}), class: "mention" },
      };
    },
  },
  exclusiveFilter: (frame) => {
    if (frame.tag === "img") return !FILE_IMAGE_SRC.test(frame.attribs.src ?? "");
    return false;
  },
};

function numericAttributes(html: string) {
  // colspan/rowspan/colwidth/start must be small integers (or comma lists for colwidth).
  return html.replace(/\s(colspan|rowspan|start)="([^"]*)"/g, (match, name: string, value: string) => (/^\d{1,3}$/.test(value) ? ` ${name}="${value}"` : ""))
    .replace(/\scolwidth="([^"]*)"/g, (match, value: string) => (/^\d{1,4}(,\d{1,4}){0,20}$/.test(value) ? ` colwidth="${value}"` : ""));
}

/** Sanitise doc HTML for storage or display. Never throws; oversized input is truncated first. */
export function sanitizeDocHtml(html: string | null | undefined): string {
  const input = (html ?? "").slice(0, MAX_DOC_HTML_LENGTH);
  return numericAttributes(sanitizeHtml(input, OPTIONS)).trim();
}

/** Plain text of (already sanitised) doc HTML, for search, previews and diffs. */
export function htmlToText(html: string | null | undefined): string {
  const spaced = (html ?? "").replace(/<(\/(p|h[1-6]|li|blockquote|pre|tr|div)|br\s*\/?|hr\s*\/?)>/gi, "$&\n").replace(/<\/(td|th)>/gi, "$& ");
  const text = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {}, nonTextTags: ["script", "style", "textarea", "noscript", "title"] });
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}

/** User ids mentioned in sanitised doc HTML (`<span data-type="mention" data-id>`), unique. */
export function extractMentionIds(html: string | null | undefined): string[] {
  const ids = new Set<string>();
  for (const match of (html ?? "").matchAll(/<span\b[^>]*\bdata-type="mention"[^>]*>/g)) {
    const id = /\bdata-id="([A-Za-z0-9_-]{1,64})"/.exec(match[0])?.[1];
    if (id) ids.add(id);
  }
  return [...ids];
}

/** File ids referenced by images in sanitised doc HTML. */
export function extractImageFileIds(html: string | null | undefined): string[] {
  const ids = new Set<string>();
  for (const match of (html ?? "").matchAll(/<img\b[^>]*\bsrc="\/api\/files\/([A-Za-z0-9_-]{1,64})"/g)) ids.add(match[1]!);
  return [...ids];
}
