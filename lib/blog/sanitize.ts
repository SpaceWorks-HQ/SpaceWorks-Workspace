import sanitizeHtml from "sanitize-html";
import { MAX_POST_HTML } from "@/lib/blog/rules";

/**
 * Server-side allow-list for blog post HTML. The editor (tiptap StarterKit)
 * produces headings, paragraphs, lists, quotes, code, links and rules; this
 * keeps exactly that and nothing else: no scripts, styles, event handlers,
 * images, iframes or forms. Posts are public, so links to other sites get
 * rel="noopener noreferrer nofollow ugc" and open in a new tab.
 *
 * Every body is sanitised before it is stored and again before it is rendered.
 */

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["h2", "h3", "h4", "p", "br", "hr", "blockquote", "strong", "em", "s", "u", "code", "pre", "a", "ul", "ol", "li"],
  allowedAttributes: { a: ["href", "title", "target", "rel"], ol: ["start"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  nonTextTags: ["script", "style", "textarea", "option", "noscript", "title", "iframe", "object", "embed", "svg", "math", "template"],
  transformTags: {
    h1: "h2",
    b: "strong",
    i: "em",
    strike: "s",
    del: "s",
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const raw = (attribs.href ?? "").trim();
      const internal = raw.startsWith("/") && !raw.startsWith("//");
      const href = internal || /^(https?:\/\/|mailto:)/i.test(raw) ? raw : "";
      return {
        tagName,
        attribs: {
          ...(href ? { href } : {}),
          ...(attribs.title ? { title: attribs.title.slice(0, 200) } : {}),
          ...(internal || !href ? {} : { target: "_blank", rel: "noopener noreferrer nofollow ugc" }),
        },
      };
    },
  },
};

export function sanitizeBlogHtml(html: string): string {
  return sanitizeHtml(html.slice(0, MAX_POST_HTML), OPTIONS).trim();
}
