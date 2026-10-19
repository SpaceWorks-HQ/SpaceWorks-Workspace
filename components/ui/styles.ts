/**
 * Class strings shared by server and client components. Kept out of
 * "use client" modules: a server component importing a plain value from a
 * client module receives a client reference instead of the value.
 */

/**
 * Shared look for text inputs, textareas, and selects (docs/DESIGN.md §4.2):
 * white panel with the 3:1 outline border, ink border on hover, accent border
 * plus the focus ring on focus, danger border when invalid. 44px tall, 10px radius.
 */
export const controlClasses =
  "block min-h-11 w-full rounded-md border border-line-strong bg-panel px-3.5 py-[9px] text-base text-ink placeholder:text-ink-muted transition-colors duration-[120ms] ease-yy hover:border-ink focus:border-accent focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--yy-focus)] disabled:cursor-not-allowed disabled:border-line disabled:bg-surface disabled:text-ink-muted aria-[invalid=true]:border-danger-fg read-only:border-line read-only:bg-surface";
