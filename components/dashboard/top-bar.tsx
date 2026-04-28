"use client"

import { Bell, Search, Plus, Command } from "lucide-react"

export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/85 backdrop-blur-md px-4 lg:px-8">
      {/* Search */}
      <div className="flex-1 max-w-xl">
        <label htmlFor="global-search" className="sr-only">
          Search submissions, materials and team members
        </label>
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            id="global-search"
            type="search"
            placeholder="Search submissions, materials, members..."
            className="h-10 w-full rounded-xl border border-border bg-background pl-9 pr-20 text-[14px] font-medium text-foreground placeholder:text-[#a39e98] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0"
          />
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden md:inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Command className="h-3 w-3" />K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        {/* Notifications */}
        <button
          type="button"
          aria-label="Notifications, 3 unread"
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background transition-colors hover:bg-muted"
        >
          <Bell className="h-[18px] w-[18px]" />
          <span
            className="absolute top-2 right-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background"
            aria-hidden="true"
          />
        </button>

        {/* New submission CTA */}
        <button
          type="button"
          className="hidden sm:inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-10 text-[14px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
        >
          <Plus className="h-4 w-4" />
          New submission
        </button>

        {/* Avatar */}
        <button
          type="button"
          className="ml-1 flex items-center gap-2 rounded-xl border border-border bg-background pl-1 pr-2.5 h-10 transition-colors hover:bg-muted"
          aria-label="Account menu"
        >
          <div className="h-8 w-8 rounded-lg bg-warm-white flex items-center justify-center text-[12px] font-semibold text-foreground">
            AM
          </div>
          <div className="hidden md:flex flex-col leading-tight text-left">
            <span className="text-[12px] font-semibold">Alex Morgan</span>
            <span className="text-[11px] font-medium text-muted-foreground">Manager</span>
          </div>
        </button>
      </div>
    </header>
  )
}
