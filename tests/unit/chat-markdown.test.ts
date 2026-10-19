import { describe, expect, it } from "vitest";
import { renderMarkdown, safeHref } from "@/lib/chat/markdown";
import { renderMessageHtml, sanitizeMessageHtml } from "@/lib/chat/sanitize";

const render = (body: string, lookups = {}) => renderMessageHtml(body, lookups);

describe("chat markdown-lite", () => {
  it("renders bold, italic, strike and inline code", () => {
    expect(render("**bold** *it* _also_ ~~gone~~ `x<y`")).toBe(
      "<p><strong>bold</strong> <em>it</em> <em>also</em> <del>gone</del> <code>x&lt;y</code></p>",
    );
  });

  it("keeps snake_case and lone asterisks as text", () => {
    expect(render("use snake_case_names and 2 * 3 * 4")).toBe("<p>use snake_case_names and 2 * 3 * 4</p>");
  });

  it("renders lists, quotes and paragraphs with line breaks", () => {
    expect(render("Parts:\n- resistor\n- led\n\n1. solder\n2. test\n> quoted")).toBe(
      "<p>Parts:</p><ul><li>resistor</li><li>led</li></ul><ol><li>solder</li><li>test</li></ol><blockquote>quoted</blockquote>",
    );
    expect(render("line one\nline two")).toBe("<p>line one<br />line two</p>");
  });

  it("renders fenced code without formatting inside", () => {
    expect(render("```js\nconst a = **b** <i>;\n```")).toBe("<pre><code>const a = **b** &lt;i&gt;;</code></pre>");
  });

  it("links safe URLs and markdown links, trimming trailing punctuation", () => {
    const html = render("See https://example.org/a_b. and [docs](https://docs.example.org/x)");
    expect(html).toContain('<a href="https://example.org/a_b" class="sw-link" target="_blank" rel="noopener noreferrer nofollow">https://example.org/a_b</a>.');
    expect(html).toContain('<a href="https://docs.example.org/x" class="sw-link" target="_blank" rel="noopener noreferrer nofollow">docs</a>');
  });

  it("refuses dangerous link schemes", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("//evil.example")).toBeNull();
    expect(safeHref("/w/kochi/chat/general")).toBe("/w/kochi/chat/general");
    const html = render("[click](javascript:alert(1))");
    expect(html).not.toContain("href");
    expect(html).toContain("[click](javascript:alert(1))");
  });

  it("escapes HTML the author typed", () => {
    const html = render('<script>alert(1)</script> <img src=x onerror="alert(1)"> "quotes"');
    expect(html).not.toMatch(/<script|<img/);
    expect(html).toContain("&lt;script&gt;");
  });

  it("does not let URLs break out of attributes", () => {
    const html = render('https://example.org/"onmouseover="alert(1)');
    expect(html).not.toMatch(/<a[^>]*onmouseover/);
    expect(html).toContain('href="https://example.org/"');
  });

  it("renders mention, channel and broadcast tokens", () => {
    const html = render("hi <@u1> and <@u2> in <#c1> <#c9> <!here>", {
      users: { u1: "Meera Nair", u2: "Joel <b>" },
      channels: { c1: { name: "general", href: "/w/kochi/chat/general" } },
      viewerId: "u1",
    });
    expect(html).toContain('<span class="sw-mention sw-mention-me" data-user-id="u1">@Meera Nair</span>');
    expect(html).toContain('<span class="sw-mention" data-user-id="u2">@Joel &lt;b&gt;</span>');
    expect(html).toContain('<a href="/w/kochi/chat/general" class="sw-channel">#general</a>');
    expect(html).toContain('<span class="sw-channel">#private-channel</span>');
    expect(html).toContain("@here");
  });

  it("links known task references only", () => {
    const html = render("Fixed BOT-12, not ABC-3", { tasks: { "BOT-12": "/w/kochi/projects/BOT/tasks/12" } });
    expect(html).toContain('<a href="/w/kochi/projects/BOT/tasks/12" class="sw-task">BOT-12</a>');
    expect(html).toContain("ABC-3");
    expect(html).not.toContain("ABC-3</a>");
  });

  it("drops stray placeholder characters", () => {
    expect(renderMarkdown("a\u00000\u0000b")).toBe("<p>a0b</p>");
  });
});

describe("message HTML sanitizer", () => {
  it("strips tags and attributes outside the allow-list", () => {
    const html = sanitizeMessageHtml('<p onclick="x">hi<img src=x><iframe></iframe><a href="javascript:alert(1)" class="evil sw-link">x</a></p>');
    expect(html).not.toMatch(/onclick|<img|<iframe|javascript:|evil/);
  });

  it("forces safe rel and target on external links", () => {
    expect(sanitizeMessageHtml('<a href="https://x.org">x</a>')).toBe('<a href="https://x.org" class="sw-link" target="_blank" rel="noopener noreferrer nofollow">x</a>');
    expect(sanitizeMessageHtml('<a href="/w/k/chat/general" target="_top">x</a>')).toBe('<a href="/w/k/chat/general" class="sw-link">x</a>');
  });
});
