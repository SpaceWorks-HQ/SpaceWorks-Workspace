"use client";

import { memo, useState } from "react";
import { Bot, Download, Ellipsis, FileText, Link as LinkIcon, MessageSquareText, Pencil, Pin, PinOff, SmilePlus, Trash2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDayTime, formatRelativeTime } from "@/lib/format/datetime";
import { REACTIONS } from "@/lib/chat/client";
import type { MessageDTO } from "@/lib/chat/types";
import { Avatar, Chip } from "@/components/ui/display";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/menu";
import { fileSize, messageBodyClass, timeLabel } from "@/components/chat/ui";

export type MessageActions = {
  onReact: (message: MessageDTO, emoji: string) => void;
  onReply?: (message: MessageDTO) => void;
  onPin: (message: MessageDTO, pinned: boolean) => void;
  onEdit: (message: MessageDTO) => void;
  onDelete: (message: MessageDTO) => void;
  onCopyLink: (message: MessageDTO) => void;
};

function authorName(message: MessageDTO): string {
  if (message.origin?.kind === "notify") return "Notifications";
  if (message.authorKind === "ASSISTANT") return message.author?.name ? `${message.author.name} via the assistant` : "Space Works Assistant";
  if (message.authorKind === "SYSTEM" && !message.author) return "Space Works";
  return message.author?.name ?? "Former member";
}

/** One message row: header, body, attachments, reactions, thread summary and a hover toolbar. */
export const MessageItem = memo(function MessageItem({
  message,
  compact,
  highlighted,
  canReact,
  timeZone,
  actions,
  editor,
}: {
  message: MessageDTO;
  /** Continues the previous message from the same person: no avatar or name. */
  compact: boolean;
  highlighted?: boolean;
  canReact: boolean;
  timeZone: string;
  actions: MessageActions;
  /** Inline editor that replaces the body while editing. */
  editor?: React.ReactNode;
}) {
  const [touched, setTouched] = useState(false);
  const isCard = message.origin?.kind === "notify";
  const name = authorName(message);
  const time = timeLabel(message.createdAt, timeZone);
  const fullTime = formatDayTime(message.createdAt, timeZone);
  const showToolbar = !message.deleted && !editor;

  return (
    <article
      id={`message-${message.id}`}
      aria-label={`${name}, ${fullTime}`}
      onPointerUp={(event) => {
        if (event.pointerType === "touch") setTouched((value) => !value);
      }}
      className={cn(
        "group relative flex gap-3 px-4 transition-colors duration-[120ms] hover:bg-subtle focus-within:bg-subtle",
        compact ? "py-0.5" : "pt-2.5 pb-1",
        message.mentionsMe && "bg-highlight-soft hover:bg-highlight-soft",
        highlighted && "bg-warning-bg hover:bg-warning-bg",
      )}
    >
      <div className="w-9 shrink-0">
        {compact ? (
          <time dateTime={message.createdAt} title={fullTime} className="invisible block pt-0.5 text-right text-[11px] leading-5 text-ink-muted tabular-nums group-hover:visible group-focus-within:visible">
            {time.replace(/ (AM|PM)$/, "")}
          </time>
        ) : message.authorKind === "ASSISTANT" ? (
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-primary text-on-primary">
            <Bot aria-hidden className="size-5" />
          </span>
        ) : (
          <Avatar name={name} src={message.author?.image} size="sm" tone={isCard ? "ink" : "neutral"} className="size-9" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!compact ? (
          <header className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[15px] font-semibold text-ink">{name}</span>
            {message.authorKind === "ASSISTANT" ? <Chip tone="accent" size="sm">Assistant</Chip> : null}
            {message.origin?.kind === "bridge" ? <Chip tone="info" size="sm">{`via ${message.origin.label}`}</Chip> : null}
            {isCard ? <Chip tone="neutral" size="sm">Routing card</Chip> : null}
            <time dateTime={message.createdAt} title={fullTime} className="text-caption text-ink-muted tabular-nums" suppressHydrationWarning>
              {time}
            </time>
          </header>
        ) : null}

        {message.deleted ? (
          <p className="text-body-ui italic text-ink-muted">This message was deleted.</p>
        ) : editor ? (
          editor
        ) : (
          <div className={cn(isCard && "mt-1 rounded-lg border border-line bg-surface px-3 py-2.5")}>
            {message.html ? <div className={messageBodyClass} dangerouslySetInnerHTML={{ __html: message.html }} /> : null}
            {message.editedAt ? <span className="text-caption text-ink-muted"> (edited)</span> : null}
          </div>
        )}

        {message.attachments.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-2" aria-label="Attachments">
            {message.attachments.map((file) =>
              file.isImage ? (
                <li key={file.id}>
                  <a href={file.url} target="_blank" rel="noopener" className="block overflow-hidden rounded-lg border border-line bg-surface" aria-label={`Open ${file.filename}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- private files are served by the app's authorised route */}
                    <img src={file.url} alt={file.filename} loading="lazy" className="block max-h-60 max-w-[min(100%,360px)] object-contain" />
                  </a>
                </li>
              ) : (
                <li key={file.id}>
                  <a
                    href={file.downloadUrl}
                    className="flex min-h-12 max-w-[320px] items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 transition-colors duration-[120ms] hover:bg-subtle"
                  >
                    <FileText aria-hidden className="size-5 shrink-0 text-ink-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label text-ink">{file.filename}</span>
                      <span className="block text-caption text-ink-muted tabular-nums">{fileSize(file.size)}</span>
                    </span>
                    <Download aria-hidden className="size-4 shrink-0 text-ink-muted" />
                    <span className="sr-only">Download</span>
                  </a>
                </li>
              ),
            )}
          </ul>
        ) : null}

        {message.reactions.length > 0 ? (
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Reactions">
            {message.reactions.map((reaction) => (
              <li key={reaction.emoji}>
                <button
                  type="button"
                  disabled={!canReact}
                  aria-pressed={reaction.mine}
                  title={`${reaction.label}: ${reaction.names.join(", ")}`}
                  aria-label={`${reaction.label}, ${reaction.count}${reaction.mine ? ", including you" : ""}`}
                  onClick={() => actions.onReact(message, reaction.emoji)}
                  className={cn(
                    "inline-flex min-h-8 items-center gap-1 rounded-full border px-2 text-sm tabular-nums transition-colors duration-[120ms]",
                    reaction.mine ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-panel text-ink-secondary hover:bg-muted",
                  )}
                >
                  <span aria-hidden>{reaction.emoji}</span>
                  <span className="font-semibold">{reaction.count}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {message.pinned ? (
          <p className="mt-1 flex items-center gap-1 text-caption text-ink-muted">
            <Pin aria-hidden className="size-3.5" />
            {message.pinnedByName ? `Pinned by ${message.pinnedByName}` : "Pinned"}
          </p>
        ) : null}

        {message.replyCount > 0 && actions.onReply ? (
          <button
            type="button"
            onClick={() => actions.onReply?.(message)}
            className="mt-1 inline-flex min-h-9 items-center gap-2 rounded-md border border-transparent px-1.5 text-label text-accent-text transition-colors duration-[120ms] hover:border-line hover:bg-panel"
          >
            <span className="flex -space-x-1.5">
              {message.replyPeople.map((p) => (
                <Avatar key={p.id} name={p.name} src={p.image} size="xs" className="ring-2 ring-panel" />
              ))}
            </span>
            <span className="font-semibold">{message.replyCount === 1 ? "1 reply" : `${message.replyCount} replies`}</span>
            {message.lastReplyAt ? (
              <span className="text-caption text-ink-muted" suppressHydrationWarning>
                Last reply {formatRelativeTime(message.lastReplyAt, timeZone).toLowerCase()}
              </span>
            ) : null}
          </button>
        ) : null}
      </div>

      {showToolbar ? (
        <div
          className={cn(
            "absolute -top-4 right-3 z-10 items-center gap-0.5 rounded-lg border border-line bg-panel p-0.5 shadow-float",
            touched ? "flex" : "hidden group-hover:flex group-focus-within:flex",
          )}
        >
          {canReact ? <ReactionPicker onPick={(emoji) => actions.onReact(message, emoji)} /> : null}
          {actions.onReply ? (
            <ToolbarButton label="Reply in thread" onClick={() => actions.onReply?.(message)}>
              <MessageSquareText />
            </ToolbarButton>
          ) : null}
          {message.canPin ? (
            <ToolbarButton label={message.pinned ? "Unpin" : "Pin to channel"} onClick={() => actions.onPin(message, !message.pinned)}>
              {message.pinned ? <PinOff /> : <Pin />}
            </ToolbarButton>
          ) : null}
          <Menu>
            <MenuTrigger asChild>
              <button type="button" aria-label="More actions" title="More actions" className="inline-flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-muted hover:text-ink [&_svg]:size-[18px]">
                <Ellipsis />
              </button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<LinkIcon />} onSelect={() => actions.onCopyLink(message)}>
                Copy link
              </MenuItem>
              {message.canEdit ? (
                <MenuItem icon={<Pencil />} onSelect={() => actions.onEdit(message)}>
                  Edit message
                </MenuItem>
              ) : null}
              {message.canDelete ? (
                <>
                  <MenuSeparator />
                  <MenuItem danger icon={<Trash2 />} onSelect={() => actions.onDelete(message)}>
                    Delete message…
                  </MenuItem>
                </>
              ) : null}
            </MenuContent>
          </Menu>
        </div>
      ) : null}
    </article>
  );
});

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-muted hover:text-ink [&_svg]:size-[18px]">
      {children}
    </button>
  );
}

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label="Add reaction" title="Add reaction" className="inline-flex size-9 items-center justify-center rounded-md text-ink-secondary hover:bg-muted hover:text-ink [&_svg]:size-[18px]">
          <SmilePlus />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-1.5">
        <ul className="grid grid-cols-4 gap-1" aria-label="Reactions">
          {REACTIONS.map((reaction) => (
            <li key={reaction.emoji}>
              <button
                type="button"
                aria-label={reaction.label}
                title={reaction.label}
                onClick={() => {
                  onPick(reaction.emoji);
                  setOpen(false);
                }}
                className="inline-flex size-11 items-center justify-center rounded-md text-xl hover:bg-muted"
              >
                <span aria-hidden>{reaction.emoji}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
