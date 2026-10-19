"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { loadWorkspaceTools } from "@/app/actions/search";
import { shellMessage } from "@/lib/shell/messages";
import { CommandPalette } from "./CommandPalette";
import { OfflineRegistration } from "./OfflineRegistration";
import { NavigationFocus } from "./NavigationFocus";
import { NotificationBell } from "@/components/notification-center/Bell";
export function WorkspaceTools() {
  const { workspaceSlug: slug } = useParams<{ workspaceSlug: string }>();
  const pathname = usePathname();
  const [data, setData] =
    useState<Awaited<ReturnType<typeof loadWorkspaceTools>>>(null);
  useEffect(() => {
    let current = true;
    void loadWorkspaceTools(slug)
      .then((value) => {
        if (current) setData(value);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [slug, pathname]);
  const current = data?.slug === slug ? data : null;
  const base = `/w/${slug}`;
  return (
    <>
      <OfflineRegistration />
      <NavigationFocus />
      <div className="mb-6 flex min-w-0 flex-col gap-3 border-b border-line pb-4">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0 max-w-xl flex-1">
            {current ? (
              <CommandPalette
                slug={slug}
                userKey={current.userId}
                locale={current.locale}
                commands={current.commands}
              />
            ) : (
              <Link
                href={`${base}/search`}
                className="inline-flex min-h-11 items-center underline"
              >
                Search workspace
              </Link>
            )}
          </div>
          <NotificationBell slug={slug} />
        </div>
        {current?.pinned.length ? (
          <nav
            aria-label={shellMessage(current.locale, "pinned")}
            className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-label"
          >
            <span className="text-ink-muted">
              {shellMessage(current.locale, "pinned")}
            </span>
            {current.pinned.map((link) => (
              <Link
                key={link.id}
                href={`${base}/links#${link.id}`}
                className="inline-flex min-h-11 max-w-full items-center truncate underline"
              >
                {link.title}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </>
  );
}
