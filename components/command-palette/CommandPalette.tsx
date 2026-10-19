"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogBody,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/field";
import { QuickCreateDialog } from "./QuickCreate";
import { searchAction } from "@/app/actions/search";
import { useAppColorMode } from "@/components/providers";
import { shellMessage } from "@/lib/shell/messages";
import type { SearchHit } from "@/lib/search/query";

type Command = {
  label: string;
  href?: string;
  theme?: boolean;
  create?: "task" | "doc";
};
export function CommandPalette({
  slug,
  userKey,
  locale = "en-IN",
  commands = [],
}: {
  slug: string;
  userKey: string;
  locale?: string;
  commands?: Command[];
}) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [hits, setHits] = useState<SearchHit[]>([]),
    [recent, setRecent] = useState<string[]>([]),
    [active, setActive] = useState(0),
    [status, setStatus] = useState("");
  const [creating, setCreating] = useState<"task" | "doc" | null>(null);
  const router = useRouter();
  const { toggleColorMode } = useAppColorMode();
  const id = useId();
  const version = useRef(0);
  const key = `sww:search:${userKey}:${slug}`;
  const t = (k: Parameters<typeof shellMessage>[1]) => shellMessage(locale, k);
  const options: Array<{
    key: string;
    label: string;
    group: string;
    href?: string;
    theme?: boolean;
    create?: "task" | "doc";
    query?: string;
  }> = query.trim()
    ? [
        ...commands
          .filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))
          .map((c, i) => ({ ...c, key: `c${i}`, group: t("commands") })),
        ...Object.values(Object.groupBy(hits, (h) => h.entityType)).flatMap(
          (rows) =>
            (rows ?? []).map((h) => ({
              key: h.id,
              label: h.title,
              href: h.url,
              group: h.entityType.replaceAll("_", " "),
            })),
        ),
      ]
    : [
        ...recent.map((q, i) => ({
          key: `r${i}`,
          label: q,
          query: q,
          group: t("recent"),
        })),
        ...commands.map((c, i) => ({
          ...c,
          key: `c${i}`,
          group: t("commands"),
        })),
      ];
  function remember(value: string) {
    const next = [value, ...recent.filter((q) => q !== value)].slice(0, 6);
    setRecent(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {}
  }
  function choose(option: (typeof options)[number]) {
    if (option.query) {
      setQuery(option.query);
      setActive(0);
      return;
    }
    if (query.trim()) remember(query.trim());
    setOpen(false);
    if (option.create) setCreating(option.create);
    else if (option.theme) toggleColorMode();
    else if (option.href) router.push(option.href);
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    const current = ++version.current;
    let cancelled = false;
    if (!open || !query.trim()) return;
    const timer = setTimeout(async () => {
      setStatus(shellMessage(locale, "searching"));
      try {
        const result = await searchAction(slug, { query });
        if (cancelled || version.current !== current) return;
        if (result.ok) {
          setHits(result.data ?? []);
          setStatus("");
        } else {
          setHits([]);
          setStatus(result.error);
        }
      } catch {
        if (!cancelled && version.current === current)
          setStatus("Couldn't search. Try again.");
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      cancelled = true;
    };
  }, [query, slug, open, locale]);
  useEffect(() => {
    if (open)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, id, open]);
  return (
    <>
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-line bg-panel px-3 text-left text-label"
        onClick={() => {
          try {
            const saved = JSON.parse(sessionStorage.getItem(key) ?? "[]");
            setRecent(
              Array.isArray(saved)
                ? saved
                    .filter(
                      (v): v is string =>
                        typeof v === "string" && v.length <= 200,
                    )
                    .slice(0, 6)
                : [],
            );
          } catch {}
          setOpen(true);
        }}
      >
        <span>{t("search")}</span>
        <kbd aria-hidden className="text-caption text-ink-muted">
          ⌘ K
        </kbd>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="md">
          <DialogHeader
            title={t("search")}
            description="Search records you can access, or run a quick command."
          />
          <DialogBody>
            <label className="sr-only" htmlFor={`${id}-input`}>
              {t("search")}
            </label>
            <Input
              id={`${id}-input`}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open}
              aria-controls={`${id}-results`}
              aria-activedescendant={
                options[active] ? `${id}-option-${active}` : undefined
              }
              autoComplete="off"
              value={query}
              onChange={(e) => {
                version.current++;
                setQuery(e.target.value);
                setHits([]);
                setStatus("");
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) =>
                    Math.max(0, Math.min(i + 1, options.length - 1)),
                  );
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(0, i - 1));
                } else if (e.key === "Home") {
                  setActive(0);
                } else if (e.key === "End") {
                  setActive(Math.max(0, options.length - 1));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (options[active]) choose(options[active]);
                  else if (query.trim()) {
                    remember(query.trim());
                    setOpen(false);
                    router.push(
                      `/w/${slug}/search?q=${encodeURIComponent(query)}`,
                    );
                  }
                }
              }}
            />
            <p role="status" className="py-2 text-caption text-ink-muted">
              {status ||
                (query && !options.length
                  ? t("noResults")
                  : `${options.length} options`)}
            </p>
            <div
              id={`${id}-results`}
              role="listbox"
              aria-label="Results and commands"
              className="max-h-[50dvh] overflow-y-auto"
            >
              {options.map((option, i) => (
                <div key={option.key}>
                  {i === 0 || options[i - 1].group !== option.group ? (
                    <p
                      className="px-3 py-2 text-overline text-ink-muted"
                      aria-hidden
                    >
                      {option.group}
                    </p>
                  ) : null}
                  <div
                    id={`${id}-option-${i}`}
                    role="option"
                    aria-selected={active === i}
                    className={`min-h-11 cursor-pointer rounded-md px-3 py-3 text-label ${active === i ? "bg-accent-soft text-accent-text" : "text-ink hover:bg-muted"}`}
                    onPointerMove={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(option)}
                  >
                    {option.label}
                    <span className="sr-only"> · {option.group}</span>
                  </div>
                </div>
              ))}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
      <QuickCreateDialog
        slug={slug}
        userId={userKey}
        kind={creating}
        onClose={() => setCreating(null)}
      />
    </>
  );
}
