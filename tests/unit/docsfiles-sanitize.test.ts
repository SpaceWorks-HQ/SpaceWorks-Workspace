import { describe, expect, it } from "vitest";
import { extractImageFileIds, extractMentionIds, htmlToText, sanitizeDocHtml } from "@/lib/docs/sanitize";

describe("sanitizeDocHtml", () => {
  it("drops scripts, event handlers, styles and frames", () => {
    const dirty = '<p onclick="steal()" style="color:red">Hi<script>alert(1)</script></p><iframe src="https://evil.test"></iframe><style>p{}</style><img src="x" onerror="alert(1)">';
    const clean = sanitizeDocHtml(dirty);
    expect(clean).toBe("<p>Hi</p>");
  });

  it("blocks javascript: and data: links but keeps http, mailto and internal links", () => {
    expect(sanitizeDocHtml('<a href="javascript:alert(1)">x</a>')).toBe("<a>x</a>");
    expect(sanitizeDocHtml('<a href="data:text/html,hi">x</a>')).toBe("<a>x</a>");
    expect(sanitizeDocHtml('<a href="https://tinkerspace.in">x</a>')).toBe('<a href="https://tinkerspace.in" target="_blank" rel="noopener noreferrer nofollow">x</a>');
    expect(sanitizeDocHtml('<a href="mailto:crew@example.org">x</a>')).toContain('href="mailto:crew@example.org"');
    expect(sanitizeDocHtml('<a href="/w/kochi/docs/abc" target="_top">x</a>')).toBe('<a href="/w/kochi/docs/abc">x</a>');
  });

  it("only keeps images served by the app's file route", () => {
    expect(sanitizeDocHtml('<img src="/api/files/abc123" alt="Board">')).toBe('<img src="/api/files/abc123" alt="Board" />');
    expect(sanitizeDocHtml('<img src="https://tracker.test/pixel.gif">')).toBe("");
    expect(sanitizeDocHtml('<img src="//tracker.test/pixel.gif">')).toBe("");
    expect(sanitizeDocHtml('<img src="data:image/png;base64,AAAA">')).toBe("");
    expect(sanitizeDocHtml('<img src="/api/files/../admin">')).toBe("");
  });

  it("keeps the editor's task lists, code blocks, tables and mentions so a round trip is lossless", () => {
    const html = [
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Solder headers</p></div></li></ul>',
      '<pre><code class="language-python">print("hi")</code></pre>',
      '<table><tbody><tr><th colspan="1" rowspan="1"><p>Tool</p></th></tr><tr><td colspan="2" rowspan="1" colwidth="120,80"><p>Laser</p></td></tr></tbody></table>',
      '<p><span data-type="mention" data-id="user_1" data-label="Meera">@Meera</span></p>',
    ].join("");
    const clean = sanitizeDocHtml(html);
    expect(clean).toContain('<ul data-type="taskList"><li data-type="taskItem" data-checked="true">');
    expect(clean).toContain('<input type="checkbox" checked="checked" disabled="disabled" />');
    expect(clean).toContain('<code class="language-python">');
    expect(clean).toContain('<td colspan="2" rowspan="1" colwidth="120,80">');
    expect(clean).toContain('<span data-type="mention" data-id="user_1" data-label="Meera" class="mention">@Meera</span>');
  });

  it("strips unknown attributes and bad values from allowed tags", () => {
    expect(sanitizeDocHtml('<code class="language-js evil">x</code>')).toBe('<code class="language-js">x</code>');
    expect(sanitizeDocHtml('<td colspan="999999">x</td>')).not.toContain("colspan");
    expect(sanitizeDocHtml('<span data-type="mention" data-id="bad id!">@x</span>')).toBe("<span>@x</span>");
    expect(sanitizeDocHtml('<li data-type="evil" data-checked="true">x</li>')).toBe("<li>x</li>");
    expect(sanitizeDocHtml('<input type="text" value="x">')).toBe("");
  });

  it("normalises legacy b/i to strong/em and handles empty input", () => {
    expect(sanitizeDocHtml("<b>a</b><i>b</i>")).toBe("<strong>a</strong><em>b</em>");
    expect(sanitizeDocHtml(null)).toBe("");
  });
});

describe("text, mentions and images", () => {
  it("extracts readable text with block breaks and decoded entities", () => {
    expect(htmlToText("<h1>Laser</h1><p>Use &amp; clean</p><ul><li><p>One</p></li><li><p>Two</p></li></ul>")).toBe("Laser\nUse & clean\nOne\n\nTwo");
  });

  it("finds unique mention ids and file image ids", () => {
    const html = '<p><span data-type="mention" data-id="u1" class="mention">@A</span> <span data-type="mention" data-id="u2">@B</span> <span data-type="mention" data-id="u1">@A</span></p><img src="/api/files/f1" alt="">';
    expect(extractMentionIds(html)).toEqual(["u1", "u2"]);
    expect(extractImageFileIds(html)).toEqual(["f1"]);
  });
});
