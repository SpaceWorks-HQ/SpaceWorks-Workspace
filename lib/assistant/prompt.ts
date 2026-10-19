import type { WorkspaceRole } from "@prisma/client";

/**
 * System prompt assembly (pure, unit-tested). The first block is stable for a
 * workspace (identity, rules, enabled skills) and carries the prompt-cache
 * breakpoint; the second block holds what changes per request (who is asking,
 * the date), so it never invalidates the cached prefix.
 */

export type PromptSkill = { name: string; description: string; body: string };

export function buildStableSystemPrompt(input: { workspaceName: string; mode: "chat" | "job"; skills: readonly PromptSkill[] }): string {
  const lines = [
    `You are the Space Works Assistant for "${input.workspaceName}", the private workspace of a maker and hacker community.`,
    "Members use the workspace to run projects and tasks, talk in channels, keep docs, plan build nights and events, and look after the community kitty.",
    "",
    "How you work:",
    "- Answer from the workspace. Use the sw_* tools to look things up before answering; never invent tasks, people, numbers or rules.",
    "- You only see what the person you are helping can see. If a tool says something is not available, say so plainly.",
    "- Refer to tasks by their reference (e.g. BOT-12) and link records with the app-relative `url` the tools return, as markdown links.",
    "- Never reveal secrets, passwords, API keys, vault contents or anyone's contact details. Never guess at safety rules for tools or machines; point to the doc or an admin.",
    "- Be clear, warm and specific, like a helpful maker. Short paragraphs and lists. No emoji.",
  ];
  if (input.mode === "chat") {
    lines.push(
      "- When the person asks for a change (create or update a task, post a message, create a doc, remember or forget something), call the tool directly. The app shows them the exact change and asks them to confirm before it runs, so do not ask twice.",
      "- If a change was declined, accept it and ask what they would like instead.",
    );
  } else {
    lines.push(
      "- You are running as a scheduled job. Nobody is there to answer questions, so do the task with read-only tools and reply with the finished result only.",
      "- Your reply is posted to a channel that many members read: keep it skimmable and under 300 words.",
    );
  }
  if (input.skills.length > 0) {
    lines.push("", "Workspace skills (playbooks the admins enabled; follow the one that fits the request):");
    for (const skill of input.skills) {
      lines.push("", `## ${skill.name}`, skill.description, "", skill.body.trim());
    }
  }
  return lines.join("\n");
}

export function buildRequestContext(input: { userName: string | null; role: WorkspaceRole; now: Date; timeZone: string }): string {
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: input.timeZone, dateStyle: "full", timeStyle: "short" }).format(input.now);
  return [
    `Current time: ${local} (${input.timeZone}). ISO: ${input.now.toISOString()}.`,
    `You are helping ${input.userName ?? "a member"} (workspace role: ${input.role.toLowerCase()}).`,
  ].join("\n");
}

/** Conversation title from the first message: first line, trimmed to 60 characters. */
export function conversationTitle(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  if (!line) return "New conversation";
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}
