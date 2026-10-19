/**
 * Markdown-lite for chat messages (pure). Supports **bold**, *italic* /
 * _italic_, ~~strike~~, `code`, fenced code blocks, [links](https://…),
 * bare URLs, "- " / "1. " lists, "> " quotes, mention/channel/broadcast
 * tokens and task references (BOT-12).
 *
 * Everything the author typed is HTML-escaped first; only the markup this
 * module emits survives. The server additionally runs the result through
 * `sanitizeMessageHtml` (lib/chat/sanitize.ts) before it reaches a browser.
 */

export type RenderLookups = {
  /** userId → display name. */
  users?: Record<string, string>;
  /** channelId → { name, href } for channels the viewer can see. */
  channels?: Record<string, { name: string; href: string }>;
  /** "KEY-12" → href for tasks the viewer can see. */
  tasks?: Record<string, string>;
  /** Highlights mentions of the viewer. */
  viewerId?: string;
};

const PH = "\u0000";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** http(s) and mailto links, or app-relative workspace paths. Everything else is refused. */
export function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (url.length === 0 || url.length > 2000) return null;
  if (/^\/w\/[A-Za-z0-9][\w\-./?=&%#]*$/.test(url) && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") return parsed.href;
  } catch {
    return null;
  }
  return null;
}

function link(href: string, label: string, className = "sw-link"): string {
  const external = !href.startsWith("/");
  return `<a href="${escapeHtml(href)}" class="${className}"${external ? ' target="_blank" rel="noopener noreferrer nofollow"' : ""}>${label}</a>`;
}

/** Split a trailing punctuation run off a bare URL ("see https://x.org." → "https://x.org" + "."). */
function trimUrl(url: string): [string, string] {
  let end = url.length;
  while (end > 0 && /[.,!?;:'"]/.test(url[end - 1]!)) end -= 1;
  let candidate = url.slice(0, end);
  if (candidate.endsWith(")") && (candidate.match(/\(/g)?.length ?? 0) < (candidate.match(/\)/g)?.length ?? 0)) {
    candidate = candidate.slice(0, -1);
  }
  return [candidate, url.slice(candidate.length)];
}

function renderInline(text: string, lookups: RenderLookups): string {
  const stash: string[] = [];
  const keep = (html: string) => `${PH}${stash.push(html) - 1}${PH}`;
  let out = text;

  out = out.replace(/`([^`\n]+)`/g, (_m, code: string) => keep(`<code>${escapeHtml(code)}</code>`));
  out = out.replace(/<@([A-Za-z0-9_-]{1,64})>/g, (_m, id: string) => {
    const name = lookups.users?.[id];
    const mine = lookups.viewerId === id;
    return keep(`<span class="sw-mention${mine ? " sw-mention-me" : ""}" data-user-id="${escapeHtml(id)}">@${escapeHtml(name ?? "former member")}</span>`);
  });
  out = out.replace(/<#([A-Za-z0-9_-]{1,64})>/g, (_m, id: string) => {
    const channel = lookups.channels?.[id];
    return keep(channel ? link(channel.href, `#${escapeHtml(channel.name)}`, "sw-channel") : `<span class="sw-channel">#private-channel</span>`);
  });
  out = out.replace(/<!(channel|here)>/g, (_m, word: string) => keep(`<span class="sw-mention sw-mention-me">@${word}</span>`));
  out = out.replace(/\[([^\]\n]{1,200})\]\(([^)\s\u0000]{1,2000})\)/g, (match, label: string, url: string) => {
    const href = safeHref(url);
    return href ? keep(link(href, escapeHtml(label))) : match;
  });
  out = out.replace(/\bhttps?:\/\/[^\s<>"'`\u0000]+/g, (match) => {
    const [url, rest] = trimUrl(match);
    const href = safeHref(url);
    return href ? `${keep(link(href, escapeHtml(url)))}${rest}` : match;
  });

  out = escapeHtml(out);

  if (lookups.tasks) {
    out = out.replace(/\b([A-Z][A-Z0-9]{1,9})-(\d{1,7})\b/g, (match) => {
      const href = lookups.tasks?.[match];
      return href ? keep(link(href, match, "sw-task")) : match;
    });
  }
  out = out
    .replace(/\*\*(?=\S)([^\n]*?\S)\*\*/g, "<strong>$1</strong>")
    .replace(/~~(?=\S)([^\n]*?\S)~~/g, "<del>$1</del>")
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, "$1<em>$2</em>")
    .replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, "$1<em>$2</em>");

  // Restore stashed fragments; a link label may itself hold a stashed mention.
  const pattern = new RegExp(`${PH}(\\d+)${PH}`, "g");
  for (let pass = 0; pass < 3 && out.includes(PH); pass += 1) {
    out = out.replace(pattern, (_m, index: string) => stash[Number(index)] ?? "");
  }
  return out.replace(new RegExp(PH, "g"), "");
}

type Block = { type: "p" | "ul" | "ol" | "quote"; lines: string[] };

function renderTextBlocks(text: string, lookups: RenderLookups): string {
  const blocks: Block[] = [];
  const push = (type: Block["type"], line: string) => {
    const last = blocks[blocks.length - 1];
    if (last && last.type === type) last.lines.push(line);
    else blocks.push({ type, lines: [line] });
  };
  let breakNext = false;
  for (const line of text.split("\n")) {
    const bullet = /^\s{0,3}[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (line.trim() === "") {
      breakNext = true;
      continue;
    }
    if (breakNext) blocks.push({ type: "p", lines: [] });
    breakNext = false;
    if (bullet) push("ul", bullet[1]!);
    else if (numbered) push("ol", numbered[1]!);
    else if (quote) push("quote", quote[1]!);
    else push("p", line);
  }
  return blocks
    .filter((block) => block.lines.length > 0)
    .map((block) => {
      const lines = block.lines.map((line) => renderInline(line, lookups));
      if (block.type === "ul") return `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul>`;
      if (block.type === "ol") return `<ol>${lines.map((l) => `<li>${l}</li>`).join("")}</ol>`;
      if (block.type === "quote") return `<blockquote>${lines.join("<br>")}</blockquote>`;
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
}

/** Render a stored message body to HTML (escape first, then the markdown subset). */
export function renderMarkdown(body: string, lookups: RenderLookups = {}): string {
  // Placeholders use NUL, which normalised bodies never contain; drop any stray one.
  const text = body.replace(new RegExp(PH, "g"), "");
  const parts = text.split("```");
  const closed = parts.length % 2 === 1;
  let html = "";
  parts.forEach((part, index) => {
    const isCode = index % 2 === 1 && (closed || index < parts.length - 1);
    if (isCode) {
      const code = part.replace(/^[a-z0-9+#-]{1,20}\n/i, "").replace(/^\n/, "").replace(/\n$/, "");
      html += `<pre><code>${escapeHtml(code)}</code></pre>`;
    } else {
      const segment = index % 2 === 1 ? `\`\`\`${part}` : part;
      html += renderTextBlocks(segment, lookups);
    }
  });
  return html;
}
