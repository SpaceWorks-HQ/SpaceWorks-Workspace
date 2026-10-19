import "server-only";

import sanitizeHtml from "sanitize-html";
import { renderMarkdown, type RenderLookups } from "@/lib/chat/markdown";

/**
 * Server-side allow-list for rendered message HTML. `renderMarkdown` already
 * escapes everything the author typed; this is the second, independent line
 * of defence before HTML reaches `dangerouslySetInnerHTML`.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "del", "code", "pre", "ul", "ol", "li", "blockquote", "a", "span"],
  allowedAttributes: {
    a: ["href", "class", "target", "rel"],
    span: ["class", "data-user-id"],
  },
  allowedClasses: {
    a: ["sw-link", "sw-channel", "sw-task"],
    span: ["sw-mention", "sw-mention-me", "sw-channel"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  disallowedTagsMode: "escape",
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href ?? "";
      const next: sanitizeHtml.Attributes = { href, class: attribs.class ?? "sw-link" };
      if (!href.startsWith("/w/")) {
        next.target = "_blank";
        next.rel = "noopener noreferrer nofollow";
      }
      return { tagName, attribs: next };
    },
  },
};

export function sanitizeMessageHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}

/** Stored body → safe HTML for one viewer. */
export function renderMessageHtml(body: string, lookups: RenderLookups): string {
  return sanitizeMessageHtml(renderMarkdown(body, lookups));
}
