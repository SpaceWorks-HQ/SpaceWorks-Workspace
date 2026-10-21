import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { parseMarkdown, type Block, type Inline } from "@/lib/assistant/markdown";

/** Renders assistant markdown as React elements only (no HTML injection). */
export function Markdown({ source, className }: { source: string; className?: string }) {
  return <div className={cn("flex flex-col gap-3 text-body-ui text-ink [overflow-wrap:anywhere]", className)}>{parseMarkdown(source).map(renderBlock)}</div>;
}

function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.text}</Fragment>;
      case "strong":
        return <strong key={index} className="font-semibold">{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "code":
        return <code key={index} className="rounded-sm bg-muted px-1.5 py-0.5 text-[0.92em]">{node.text}</code>;
      case "link":
        return node.external ? (
          <a key={index} href={node.href} target="_blank" rel="noopener noreferrer nofollow" className="font-semibold text-accent-text underline underline-offset-2">
            {renderInline(node.children)}
          </a>
        ) : (
          <Link key={index} href={node.href} className="font-semibold text-accent-text underline underline-offset-2">
            {renderInline(node.children)}
          </Link>
        );
    }
  });
}

function renderBlock(block: Block, index: number): ReactNode {
  switch (block.type) {
    case "heading": {
      const Tag = `h${block.level + 1}` as "h3" | "h4" | "h5";
      return <Tag key={index} className={cn("font-sans font-semibold text-ink", block.level === 2 ? "text-title" : "text-label")}>{renderInline(block.children)}</Tag>;
    }
    case "paragraph":
      return <p key={index}>{renderInline(block.children)}</p>;
    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag key={index} className={cn("flex flex-col gap-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}>
          {block.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
        </Tag>
      );
    }
    case "quote":
      return <blockquote key={index} className="border-l-2 border-line-strong pl-3 text-ink-secondary">{renderInline(block.children)}</blockquote>;
    case "code":
      return <pre key={index} className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-5"><code>{block.text}</code></pre>;
    case "rule":
      return <hr key={index} className="border-line" />;
  }
}
