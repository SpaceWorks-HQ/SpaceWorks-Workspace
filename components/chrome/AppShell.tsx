"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bell, ChevronsUpDown, LogOut, Menu as MenuIcon, Moon, ShieldCheck, Sun, UserRound, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ShellData } from "@/lib/appShell";
import { activeNavKey } from "@/lib/nav";
import { LAST_WORKSPACE_COOKIE } from "@/lib/workspaceCookie";
import { SpaceWorksWorkspaceLogo } from "@/components/brand/SpaceWorksLogo";
import { useAppColorMode } from "@/components/providers";
import { useRealtime } from "@/components/realtime/useRealtime";
import { Avatar } from "@/components/ui/display";
import { IconButton } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";

function NavLink({ href, active, children, onNavigate }: { href: string; active: boolean; children: string; onNavigate?: () => void }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-10 items-center rounded-[10px] px-3 text-[15px] text-ink transition-colors duration-[120ms] hover:bg-sidebar-hover",
        active && "bg-sidebar-active font-semibold text-on-sidebar-active hover:bg-sidebar-active",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  );
}

function WorkspaceSwitcher({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  return (
    <Menu>
      <MenuTrigger className="group w-full rounded-[10px] border border-line bg-panel text-left transition-colors hover:border-line-strong">
        <span className="flex min-h-[58px] items-center gap-2.5 px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-ink">{data.workspace.name}</span>
            <span className="block text-caption text-ink-muted">{data.workspace.roleLabel}</span>
          </span>
          <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
          <span className="sr-only">Switch workspace</span>
        </span>
      </MenuTrigger>
      <MenuContent align="start" className="min-w-[240px]">
        <MenuLabel>Workspaces</MenuLabel>
        {data.workspaces.map((workspace) => (
          <MenuItem key={workspace.slug} asChild>
            <Link href={`/w/${workspace.slug}`} onClick={onNavigate} aria-current={workspace.slug === data.workspace.slug ? "true" : undefined}>
              <span className={cn("min-w-0 truncate", workspace.slug === data.workspace.slug && "font-semibold")}>{workspace.name}</span>
            </Link>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

function AccountMenu({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  const { mode, toggleColorMode } = useAppColorMode();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const name = data.user.name ?? data.user.email;
  return (
    <Menu>
      <MenuTrigger
        ref={triggerRef}
        className="flex min-h-12 w-full items-center gap-2.5 rounded-[10px] border border-line bg-panel p-2 text-left transition-colors hover:bg-surface data-[state=open]:bg-surface"
      >
        <Avatar name={name} src={data.user.image} size="sm" className="size-8 text-[11px]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{name}</span>
          {data.user.name ? <span className="block truncate text-caption text-ink-muted">{data.user.email}</span> : null}
        </span>
        <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-ink-muted" />
      </MenuTrigger>
      <MenuContent side="top" align="start" className="min-w-[232px]">
        <MenuLabel>{name}</MenuLabel>
        <MenuItem asChild icon={<UserRound />}>
          <Link href="/account" onClick={onNavigate}>Account settings</Link>
        </MenuItem>
        {data.isSuperAdmin ? (
          <MenuItem asChild icon={<ShieldCheck />}>
            <Link href="/admin" onClick={onNavigate}>Instance admin</Link>
          </MenuItem>
        ) : null}
        <MenuItem
          icon={mode === "dark" ? <Sun /> : <Moon />}
          onSelect={() => {
            const rect = triggerRef.current?.getBoundingClientRect();
            toggleColorMode(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined);
          }}
        >
          {mode === "dark" ? "Light mode" : "Dark mode"}
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<LogOut />} onSelect={() => void signOut({ callbackUrl: "/login" })}>
          Sign out
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}

function NotificationsLink({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  const count = data.unreadNotifications;
  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  return (
    <Link
      href={`/w/${data.workspace.slug}/notifications`}
      onClick={onNavigate}
      aria-label={label}
      className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink transition-colors hover:bg-sidebar-hover"
    >
      <Bell aria-hidden className="size-[18px]" />
      {count > 0 ? (
        <span aria-hidden className="absolute right-1 top-1 min-w-5 rounded-full bg-highlight px-1.5 text-center text-xs font-semibold leading-5 tabular-nums text-on-highlight">
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}

function SidebarContents({ data, onNavigate }: { data: ShellData; onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  const active = activeNavKey(data.nav, pathname);
  return (
    <div className="flex h-full flex-col gap-4 px-3 py-3.5">
      <div className="flex items-center justify-between gap-2 pl-2 pt-1">
        <Link href={`/w/${data.workspace.slug}`} onClick={onNavigate} aria-label="Workspace home" className="inline-flex rounded-md">
          <SpaceWorksWorkspaceLogo height={28} label={null} />
        </Link>
        <NotificationsLink data={data} onNavigate={onNavigate} />
      </div>
      <WorkspaceSwitcher data={data} onNavigate={onNavigate} />
      <nav aria-label="Workspace" className="flex flex-col gap-3">
        {data.nav.map((group) => (
          <div key={group.key} className="flex flex-col gap-0.5">
            {group.label ? <p className="px-3 pb-0.5 text-overline text-ink-muted">{group.label}</p> : null}
            {group.items.map((item) => (
              <NavLink key={item.key} href={item.href} active={active === item.key} onNavigate={onNavigate}>
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="mt-auto pt-2">
        <AccountMenu data={data} onNavigate={onNavigate} />
      </div>
    </div>
  );
}

/**
 * Workspace app shell (docs/DESIGN.md §4.13): a 256px Citron sidebar with
 * text-only navigation from lib/nav.ts on desktop, and a top bar with a
 * navigation sheet below the md breakpoint. Unread notifications refresh
 * live through the workspace realtime stream.
 */
export function AppShell({ data, children }: { data: ShellData; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${LAST_WORKSPACE_COOKIE}=${encodeURIComponent(data.workspace.slug)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }, [data.workspace.slug]);

  useRealtime(data.workspace.slug, (event) => {
    if (event.type === "notification.created") router.refresh();
  });

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="sticky top-0 hidden h-dvh w-[256px] shrink-0 overflow-y-auto border-r border-line bg-sidebar md:block">
        <SidebarContents data={data} />
      </aside>

      <div className="sticky top-0 z-40 flex h-14 items-center justify-between gap-2 border-b border-line bg-canvas px-4 md:hidden">
        <Link href={`/w/${data.workspace.slug}`} aria-label="Workspace home" className="inline-flex shrink-0 items-center rounded-md">
          <SpaceWorksWorkspaceLogo height={26} label={null} />
        </Link>
        <div className="flex items-center gap-1">
          <NotificationsLink data={data} />
          <DialogPrimitive.Root open={menuOpen} onOpenChange={setMenuOpen}>
            <DialogPrimitive.Trigger asChild>
              <IconButton label="Open navigation menu">
                <MenuIcon />
              </IconButton>
            </DialogPrimitive.Trigger>
            <DialogPrimitive.Portal>
              <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[rgb(20_44_42/0.48)]" />
              <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[min(288px,86vw)] overflow-y-auto border-r border-line bg-sidebar shadow-float focus:outline-none">
                <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">Workspace navigation</DialogPrimitive.Description>
                <DialogPrimitive.Close asChild>
                  <IconButton label="Close navigation menu" size="sm" className="absolute right-3 top-16 z-10">
                    <X />
                  </IconButton>
                </DialogPrimitive.Close>
                <SidebarContents data={data} onNavigate={() => setMenuOpen(false)} />
              </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
          </DialogPrimitive.Root>
        </div>
      </div>

      <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 px-4 py-6 focus:outline-none sm:px-6 md:px-10 md:py-9">
        <div className="mx-auto w-full max-w-[1200px]">{children}</div>
      </main>
    </div>
  );
}
