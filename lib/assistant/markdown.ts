/**
 * A small markdown subset for assistant and boardroom output, parsed into a
 * plain tree that React renders as elements (components/assistant/Markdown).
 * Nothing is ever injected as HTML, so model output cannot add tags, scripts
 * or event handlers; links are limited to app paths, http(s) and mailto.
 *
 * Blocks: headings (#–####), paragraphs, bullet and numbered lists, block
 * quotes, fenced code, horizontal rules. Inline: **bold**, *italic* / _italic_,
 * `code`, [text](url).
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; external: boolean; children: Inline[] };

export type Block =
  | { type: "heading"; level: 2 | 3 | 4; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] }
  | { type: "quote"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "rule" };

/** Safe link target or null (then the label renders as plain text). */
export function safeHref(raw: string): { href: string; external: boolean } | null {
  const url = raw.trim();
  if (url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\")) return { href: url, external: false };
  if (url.startsWith("#")) return { href: url, external: false };
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") return { href: parsed.toString(), external: true };
  } catch {
    // Not an absolute URL.
  }
  return null;
}

const INLINE = /(\*\*([^*]+?)\*\*)|(`([^`]+?)`)|(\[([^\]]+?)\]\(([^)\s]+?)\))|(\*([^*\s][^*]*?)\*)|(\b_([^_]+?)_\b)/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest.length > 0) {
    const match = INLINE.exec(rest);
    if (!match) {
      out.push({ type: "text", text: rest });
      break;
    }
    if (match.index > 0) out.push({ type: "text", text: rest.slice(0, match.index) });
    if (match[1]) out.push({ type: "strong", children: parseInline(match[2]!) });
    else if (match[3]) out.push({ type: "code", text: match[4]! });
    else if (match[5]) {
      const target = safeHref(match[7]!);
      const children = parseInline(match[6]!);
      out.push(target ? { type: "link", href: target.href, external: target.external, children } : { type: "text", text: match[6]! });
    } else if (match[8]) out.push({ type: "em", children: parseInline(match[9]!) });
    else if (match[10]) out.push({ type: "em", children: parseInline(match[11]!) });
    rest = rest.slice(match.index + match[0].length);
  }
  return mergeText(out);
}

function mergeText(nodes: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const node of nodes) {
    const prev = merged.at(-1);
    if (node.type === "text" && prev?.type === "text") prev.text += node.text;
    else merged.push(node);
  }
  return merged;
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ").trim()) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith("```")) code.push(lines[i++]!);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flush();
      const level = Math.min(Math.max(heading[1]!.length + 1, 2), 4) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, children: parseInline(heading[2]!.replace(/#+$/, "").trim()) });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flush();
      blocks.push({ type: "rule" });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d{1,3}[.)]\s+(.*)$/.exec(trimmed);
    if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const items: Inline[][] = [];
      let j = i;
      while (j < lines.length) {
        const t = lines[j]!.trim();
        const m = ordered ? /^\d{1,3}[.)]\s+(.*)$/.exec(t) : /^[-*+]\s+(.*)$/.exec(t);
        if (m) items.push(parseInline(m[1]!));
        else if (t && /^\s{2,}/.test(lines[j]!) && items.length) items[items.length - 1]!.push({ type: "text", text: ` ${t}` });
        else break;
        j++;
      }
      blocks.push({ type: "list", ordered, items: items.map(mergeText) });
      i = j - 1;
      continue;
    }
    if (trimmed.startsWith(">")) {
      flush();
      const quote: string[] = [];
      let j = i;
      while (j < lines.length && lines[j]!.trim().startsWith(">")) quote.push(lines[j++]!.trim().replace(/^>\s?/, ""));
      blocks.push({ type: "quote", children: parseInline(quote.join(" ")) });
      i = j - 1;
      continue;
    }
    paragraph.push(trimmed);
  }
  flush();
  return blocks;
}
