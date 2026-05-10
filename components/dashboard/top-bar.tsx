"use client"

import { useState } from "react"
import Link from "next/link"
import { Plus, LogOut, Loader2 } from "lucide-react"
import { roleLabel } from "@/lib/auth-shared"
import type { UserRole } from "@/lib/types"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"

interface TopBarProps {
  name: string
  email: string
  role: UserRole
  avatarUrl?: string | null
  primaryAction: { href: string; label: string }
}

export function TopBar({ name, email, role, avatarUrl, primaryAction }: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [isSigningOut, setIsSigningOut] = useState(false)

  async function handleSignOut() {
    setIsSigningOut(true)
    setMenuOpen(false)
    try {
      await fetch("/auth/signout", { method: "POST", redirect: "manual" })
    } finally {
      // Hard navigation: clears the Next.js client-side router cache entirely
      // so no stale authenticated RSC payloads survive after sign-out.
      window.location.href = "/auth/login"
    }
  }
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase()

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 backdrop-blur-md px-4 lg:px-8">
      <div className="hidden md:block shrink-0">
        <p className="text-[13px] font-semibold tracking-tight">Hierarchia portal</p>
        <p className="text-[11px] text-muted-foreground">Real-time submissions and reporting</p>
      </div>

      <div id="topbar-portal-target" className="min-w-0 flex-1 flex items-center justify-center px-2 sm:px-4" />

      <div className="flex items-center gap-1.5 ml-auto shrink-0">
        <Link
          href={primaryAction.href}
          aria-label={primaryAction.label}
          className="inline-flex sm:hidden items-center justify-center rounded-xl bg-primary h-10 w-10 text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          href={primaryAction.href}
          className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-10 text-[14px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {primaryAction.label}
        </Link>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="ml-1 flex items-center gap-2 rounded-xl border border-border bg-background pl-1 pr-2.5 h-10 transition-colors hover:bg-muted"
          >
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage src={avatarUrl ?? undefined} alt={name} />
              <AvatarFallback className="rounded-lg bg-warm-white text-[12px] font-semibold">
                {initials || "U"}
              </AvatarFallback>
            </Avatar>
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
              <button
                type="button"
                role="menuitem"
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-[13px] hover:bg-muted disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span>{isSigningOut ? "Signing out…" : "Sign out"}</span>
                {isSigningOut
                  ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin" aria-hidden="true" />
                  : <LogOut className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
