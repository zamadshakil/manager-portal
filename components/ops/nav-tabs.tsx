"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

const NAV = [
  { href: "/ops", label: "Dashboard", exact: true },
  { href: "/ops/backups", label: "Backups", exact: false },
  { href: "/ops/monitor", label: "Monitor", exact: false },
]

export function NavTabs() {
  const pathname = usePathname()

  return (
    <nav className="-mb-px flex items-center gap-1 overflow-x-auto whitespace-nowrap scrollbar-thin">
      {NAV.map(({ href, label, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              active
                ? "border-orange-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
