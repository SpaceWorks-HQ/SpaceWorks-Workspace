"use client";

import { usePathname } from "next/navigation";
import { NavTabs } from "@/components/ui/tabs";

export function FinanceTabs({ base, canManage }: { base: string; canManage: boolean }) {
  const pathname = usePathname();
  const items = [
    { href: base, label: "Overview", active: pathname === base },
    { href: `${base}/ledger`, label: "Ledger", active: pathname.startsWith(`${base}/ledger`) },
    { href: `${base}/invoices`, label: "Invoices", active: pathname.startsWith(`${base}/invoices`) },
    ...(canManage ? [{ href: `${base}/categories`, label: "Categories", active: pathname.startsWith(`${base}/categories`) }] : []),
  ];
  return <NavTabs items={items} label="Finance sections" />;
}
