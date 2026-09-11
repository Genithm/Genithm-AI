"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const workspaceLinks = [
  { href: "/dashboard", label: "Workspace", exact: true },
  { href: "/dashboard/ai", label: "AI" },
  { href: "/dashboard/reports", label: "Reports" },
  { href: "/dashboard/billing", label: "Plan & usage" },
  { href: "/dashboard/billing/payments", label: "Payments" },
] as const;

function isActive(pathname: string, href: string, exact = false) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardPrimaryNav({ isPlatformAdmin }: { isPlatformAdmin: boolean }) {
  const pathname = usePathname();
  const links = isPlatformAdmin
    ? [...workspaceLinks, { href: "/dashboard/admin", label: "Admin", exact: false } as const]
    : workspaceLinks;

  return (
    <nav className="dashboard-nav" aria-label="Workspace navigation">
      {links.map((link) => {
        const active = isActive(pathname, link.href, "exact" in link ? link.exact : false);
        return (
          <Link
            className={active ? "dashboard-nav-link is-active" : "dashboard-nav-link"}
            href={link.href}
            key={link.href}
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
