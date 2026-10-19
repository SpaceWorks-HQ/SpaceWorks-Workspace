import { describe, expect, it } from "vitest";
import { docToHtmlFile, docToMarkdown, exportFilename } from "@/lib/docs/markdown";
import { applyTemplateVariables, BUILTIN_DOC_TEMPLATES, templateBodyFromContent } from "@/lib/docs/templates";

describe("docToMarkdown", () => {
  it("exports headings, inline marks, links and images", () => {
    const md = docToMarkdown("Laser cutter", '<h2>Before you start</h2><p>Wear <strong>goggles</strong> and <em>check</em> the <s>old</s> <code>fan</code>. See <a href="https://tinkerspace.in">the site</a>.</p><p><img src="/api/files/f1" alt="Bed"></p>');
    expect(md).toBe("# Laser cutter\n\n## Before you start\n\nWear **goggles** and _check_ the ~~old~~ `fan`. See [the site](https://tinkerspace.in).\n\n![Bed](/api/files/f1)\n");
  });

  it("exports nested, ordered and task lists", () => {
    const md = docToMarkdown(
      "Lists",
      '<ul><li><p>One</p><ul><li><p>Inner</p></li></ul></li><li><p>Two</p></li></ul><ol start="3"><li><p>Three</p></li><li><p>Four</p></li></ol><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"></label><div><p>Done</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"></label><div><p>Todo</p></div></li></ul>',
    );
    expect(md).toContain("- One\n\n  - Inner\n- Two");
    expect(md).toContain("3. Three\n4. Four");
    expect(md).toContain("- [x] Done\n- [ ] Todo");
  });

  it("exports code blocks with language, quotes and tables", () => {
    const md = docToMarkdown(
      "Code",
      '<pre><code class="language-python">print("hi")\nprint("there")</code></pre><blockquote><p>Measure twice</p></blockquote><table><tbody><tr><th><p>Tool</p></th><th><p>Owner</p></th></tr><tr><td><p>Laser | CO2</p></td><td><p>Meera</p></td></tr></tbody></table>',
    );
    expect(md).toContain('```python\nprint("hi")\nprint("there")\n```');
    expect(md).toContain("> Measure twice");
    expect(md).toContain("| Tool | Owner |\n| --- | --- |\n| Laser \\| CO2 | Meera |");
  });

  it("escapes markdown characters in text and renders mentions by name", () => {
    const md = docToMarkdown("A *star*", '<p>Use 2*3 and [x] <span data-type="mention" data-id="u1" data-label="Meera">@Meera</span></p>');
    expect(md).toContain("# A \\*star\\*");
    expect(md).toContain("Use 2\\*3 and \\[x\\] @Meera");
  });
});

describe("HTML export and file names", () => {
  it("escapes the title and keeps the body", () => {
    const html = docToHtmlFile('<script>"x"</script>', "<p>Body</p>");
    expect(html).toContain("<title>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</title>");
    expect(html).toContain("<p>Body</p>");
    expect(html).not.toContain("<script>");
  });

  it("builds safe file names", () => {
    expect(exportFilename("Laser cutter: how-to!", "md")).toBe("Laser-cutter-how-to.md");
    expect(exportFilename("   ", "html")).toBe("doc.html");
  });
});

describe("templates", () => {
  it("fills variables and escapes values in HTML", () => {
    expect(applyTemplateVariables("<p>{{author}} on {{ date }}</p>", { author: "<Meera>", date: "19 Oct 2026", workspace: "Kochi" })).toBe("<p>&lt;Meera&gt; on 19 Oct 2026</p>");
    expect(applyTemplateVariables("Notes {{date}}", { author: "", date: "19 Oct 2026", workspace: "" }, false)).toBe("Notes 19 Oct 2026");
  });

  it("ships the four built-in templates", () => {
    expect(BUILTIN_DOC_TEMPLATES.map((template) => template.name)).toEqual(["Meeting notes", "Runbook", "How-to guide", "Project brief"]);
  });

  it("reads workspace template content defensively", () => {
    expect(templateBodyFromContent({ html: "<p>x</p>" })).toBe("<p>x</p>");
    expect(templateBodyFromContent({ markdown: "One\n\nTwo <b>" })).toBe("<p>One</p><p>Two &lt;b&gt;</p>");
    expect(templateBodyFromContent(42)).toBeNull();
    expect(templateBodyFromContent({})).toBeNull();
  });
});
