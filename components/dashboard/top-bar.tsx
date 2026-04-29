"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, LogOut } from "lucide-react"
import { roleLabel } from "@/lib/auth-shared"
import type { UserRole } from "@/lib/types"

interface TopBarProps {
  name: string
  email: string
  role: UserRole
}

export function TopBar({ name, email, role }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 backdrop-blur-md px-4 lg:px-8">
      <div className="hidden md:block">
        <p className="text-[13px] font-semibold tracking-tight">Hierarchia portal</p>
        <p className="text-[11px] text-muted-foreground">Real-time submissions and reporting</p>
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        {role === "member" ? (
          <Link
            href="/dashboard/tasks"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-10 text-[14px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Open tasks
          </Link>
        ) : role === "manager" ? (
          <Link
            href="/dashboard/tasks"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-10 text-[14px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Assign task
          </Link>
        ) : (
          <Link
            href="/dashboard/team?tab=provisioning"
            className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-10 text-[14px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Provision user
          </Link>
        )}

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="ml-1 flex items-center gap-2 rounded-xl border border-border bg-background pl-1 pr-2.5 h-10 transition-colors hover:bg-muted"
          >
            <div className="h-8 w-8 rounded-lg bg-warm-white flex items-center justify-center text-[12px] font-semibold">
              {initials || "U"}
            </div>
            <div className="hidden md:flex flex-col leading-tight text-left">
              <span className="text-[12px] font-semibold">{name}</span>
              <span className="text-[11px] font-medium text-muted-foreground">
                {roleLabel(role)}
              </span>
            </div>
          </button>

          {menuOpen ? (
            <div
              role="menu"
              className="absolute right-0 mt-2 w-56 rounded-xl border border-border bg-background p-1.5 shadow-deep z-40"
            >
              <div className="px-2.5 py-1.5">
                <p className="text-[12px] font-semibold truncate">{name}</p>
                <p className="text-[11px] text-muted-foreground truncate">{email}</p>
              </div>
              <div className="my-1 h-px bg-border" />
              <Link
                href="/dashboard/settings"
                role="menuitem"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] hover:bg-muted"
              >
                Settings
              </Link>
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  role="menuitem"
                  className="w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] hover:bg-muted"
                >
                  <span>Sign out</span>
                  <LogOut className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
