import { describe, expect, it } from "vitest";
import { renderOutboxMessage } from "@/lib/outbox";
import { renderInviteEmail } from "@/lib/email/templates";

const future = new Date(Date.now() + 3_600_000).toISOString();

describe("outbox message rendering", () => {
  it("renders an invitation with escaped workspace and inviter names", () => {
    const rendered = renderOutboxMessage("workspace-invite", {
      to: "maker@example.org",
      workspaceName: "<b>Kochi</b>",
      inviterName: "Meera & co",
      role: "MEMBER",
      inviteUrl: "https://work.example.org/invite/abc",
      expiresAt: future,
    });
    expect(rendered).not.toBe("expired");
    if (rendered === "expired") return;
    expect(rendered.to).toBe("maker@example.org");
    expect(rendered.email.html).toContain("&lt;b&gt;Kochi&lt;/b&gt;");
    expect(rendered.email.html).toContain("Meera &amp; co");
    expect(rendered.email.text).toContain("https://work.example.org/invite/abc");
  });

  it("drops expired capabilities instead of sending them", () => {
    expect(renderOutboxMessage("password-reset", { to: "a@example.org", resetUrl: "https://x.example.org/r", expiresAt: new Date(Date.now() - 1000).toISOString() })).toBe("expired");
  });

  it("rejects malformed payloads and unknown kinds", () => {
    expect(() => renderOutboxMessage("email", { to: "not-an-email", subject: "s", html: "h", text: "t" })).toThrow();
    expect(() => renderOutboxMessage("password-reset", { to: "a@example.org", resetUrl: "javascript:alert(1)", expiresAt: future })).toThrow();
    expect(() => renderOutboxMessage("unknown-kind", { to: "a@example.org" })).toThrow();
  });

  it("passes pre-rendered emails through", () => {
    const rendered = renderOutboxMessage("email", { to: "a@example.org", subject: "Digest", html: "<p>Hi</p>", text: "Hi" });
    expect(rendered).toEqual({ to: "a@example.org", email: { subject: "Digest", html: "<p>Hi</p>", text: "Hi" } });
  });

  it("says when an invitation expires", () => {
    const email = renderInviteEmail({ workspaceName: "Kochi", role: "GUEST", inviteUrl: "https://x/invite/t", expiresAt: new Date(Date.now() + 7 * 86_400_000) });
    expect(email.text).toContain("7 days");
    expect(email.text).toContain("a guest");
  });
});
