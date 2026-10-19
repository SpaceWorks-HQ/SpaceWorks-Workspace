import { parseDocument } from "htmlparser2";
import type { ChildNode, Element } from "domhandler";

/**
 * Export sanitised doc HTML as GitHub-flavoured Markdown (headings, lists,
 * task lists, code, quotes, tables, links, images) and as a standalone HTML
 * file. Pure: no I/O, unit-tested.
 */

type Ctx = { listDepth: number; inPre: boolean };

const isElement = (node: ChildNode): node is Element => node.type === "tag" || node.type === "script" || node.type === "style";

function escapeInline(text: string) {
  return text.replace(/([\\`*_[\]#|<>])/g, "\\$1");
}

function inline(nodes: ChildNode[], ctx: Ctx): string {
  return nodes.map((node) => inlineNode(node, ctx)).join("");
}

function inlineNode(node: ChildNode, ctx: Ctx): string {
  if (node.type === "text") return ctx.inPre ? node.data : escapeInline(node.data.replace(/\s+/g, " "));
  if (!isElement(node)) return "";
  const inner = () => inline(node.children, ctx);
  switch (node.name) {
    case "strong":
    case "b":
      return wrap(inner(), "**");
    case "em":
    case "i":
      return wrap(inner(), "_");
    case "s":
      return wrap(inner(), "~~");
    case "u":
      return inner();
    case "code": {
      const text = textOf(node);
      const fence = text.includes("`") ? "``" : "`";
      return `${fence}${text}${fence}`;
    }
    case "a": {
      const label = inner().trim() || node.attribs.href || "";
      return node.attribs.href ? `[${label}](${node.attribs.href.replace(/\)/g, "%29").replace(/ /g, "%20")})` : label;
    }
    case "img":
      return `![${escapeInline(node.attribs.alt ?? "")}](${node.attribs.src ?? ""})`;
    case "br":
      return "  \n";
    case "span":
      if (node.attribs["data-type"] === "mention") return `@${node.attribs["data-label"] ?? textOf(node).replace(/^@/, "")}`;
      return inner();
    default:
      return inner();
  }
}

function wrap(text: string, marker: string) {
  const trimmed = text.trim();
  if (!trimmed) return text;
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const tail = text.match(/\s*$/)?.[0] ?? "";
  return `${lead}${marker}${trimmed}${marker}${tail}`;
}

function textOf(node: ChildNode): string {
  if (node.type === "text") return node.data;
  if (!isElement(node)) return "";
  return node.children.map(textOf).join("");
}

function blocks(nodes: ChildNode[], ctx: Ctx): string[] {
  const out: string[] = [];
  let pendingInline: ChildNode[] = [];
  const flush = () => {
    const text = inline(pendingInline, ctx).trim();
    if (text) out.push(text);
    pendingInline = [];
  };
  for (const node of nodes) {
    if (isElement(node) && BLOCK_TAGS.has(node.name)) {
      flush();
      const block = blockNode(node, ctx);
      if (block) out.push(block);
    } else {
      pendingInline.push(node);
    }
  }
  flush();
  return out;
}

const BLOCK_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li", "blockquote", "pre", "hr", "table", "div", "label"]);

function blockNode(node: Element, ctx: Ctx): string {
  switch (node.name) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `${"#".repeat(Number(node.name[1]))} ${inline(node.children, ctx).trim()}`;
    case "p":
      return inline(node.children, ctx).trim();
    case "hr":
      return "---";
    case "blockquote":
      return blocks(node.children, ctx).join("\n\n").split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
    case "pre": {
      const code = node.children.find((child): child is Element => isElement(child) && child.name === "code");
      const language = code?.attribs.class?.match(/language-([A-Za-z0-9_+-]+)/)?.[1] ?? "";
      const text = textOf(code ?? node).replace(/\n$/, "");
      const fence = text.includes("```") ? "~~~~" : "```";
      return `${fence}${language}\n${text}\n${fence}`;
    }
    case "ul":
    case "ol":
      return list(node, ctx);
    case "table":
      return table(node, ctx);
    case "label":
      return "";
    default:
      return blocks(node.children, ctx).join("\n\n");
  }
}

function list(node: Element, ctx: Ctx): string {
  const ordered = node.name === "ol";
  const task = node.attribs["data-type"] === "taskList";
  let counter = Number(node.attribs.start ?? "1") || 1;
  const items = node.children.filter((child): child is Element => isElement(child) && child.name === "li");
  return items
    .map((item) => {
      const marker = ordered ? `${counter++}.` : "-";
      const checkbox = task || item.attribs["data-type"] === "taskItem" ? (item.attribs["data-checked"] === "true" ? "[x] " : "[ ] ") : "";
      const indent = " ".repeat(marker.length + 1);
      const content = blocks(item.children, { ...ctx, listDepth: ctx.listDepth + 1 }).join("\n\n");
      const lines = content.split("\n");
      return `${marker} ${checkbox}${lines[0] ?? ""}${lines.slice(1).map((line) => (line ? `\n${indent}${line}` : "\n")).join("")}`;
    })
    .join("\n");
}

function table(node: Element, ctx: Ctx): string {
  const rows: Element[] = [];
  const collect = (parent: Element) => {
    for (const child of parent.children) {
      if (!isElement(child)) continue;
      if (child.name === "tr") rows.push(child);
      else if (["thead", "tbody", "tfoot"].includes(child.name)) collect(child);
    }
  };
  collect(node);
  if (rows.length === 0) return "";
  const cells = rows.map((row) =>
    row.children
      .filter((cell): cell is Element => isElement(cell) && (cell.name === "td" || cell.name === "th"))
      .map((cell) => blocks(cell.children, ctx).join(" ").replace(/\n+/g, " ").trim()),
  );
  const width = Math.max(...cells.map((row) => row.length), 1);
  const pad = (row: string[]) => [...row, ...Array(width - row.length).fill("")];
  const [head, ...body] = cells;
  return [`| ${pad(head!).join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`, ...body.map((row) => `| ${pad(row).join(" | ")} |`)].join("\n");
}

/** Markdown for a doc: `# Title`, then the body. */
export function docToMarkdown(title: string, html: string): string {
  const body = blocks(parseDocument(html).children, { listDepth: 0, inPre: false }).join("\n\n");
  return `# ${escapeInline(title.trim() || "Untitled")}\n\n${body}`.trim() + "\n";
}

export function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A standalone HTML file for a doc (already sanitised body, escaped title). */
export function docToHtmlFile(title: string, html: string): string {
  const safeTitle = escapeHtml(title.trim() || "Untitled");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${safeTitle}</title>`,
    "<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px;line-height:1.6}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}pre{background:#f4f4f4;padding:12px;overflow:auto}</style>",
    "</head>",
    "<body>",
    `<h1>${safeTitle}</h1>`,
    html,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

/** File name for an export: letters, digits and dashes only. */
export function exportFilename(title: string, extension: "md" | "html") {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "doc";
  return `${base}.${extension}`;
}
