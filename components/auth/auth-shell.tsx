import Link from "next/link"
import type { ReactNode } from "react"
import { ShieldCheck, Sparkles, Users } from "lucide-react"
import { HierarchyVisual } from "./hierarchy-visual"

interface AuthShellProps {
  /**
   * Form content (login form, forgot-password form, etc).
   */
  children: ReactNode
  /**
   * Eyebrow label rendered above the form headline.
   * Defaults to "Welcome to Hierarchia".
   */
  eyebrow?: string
}

/**
 * Two-pane authentication shell used by login, forgot-password, and
 * update-password. On desktop it splits 50/50: form on the left, brand
 * panel on the right with the hierarchy visualization and trust copy.
 * On mobile the brand panel is hidden and the form takes the full
 * viewport with a compact brand mark above it.
 *
 * All colors come from the design-token system (bg-background, bg-card,
 * text-primary, etc.) so the shell automatically reflects the warm
 * Notion-inspired palette of the rest of the app and stays consistent
 * if the theme is ever swapped.
 */
export function AuthShell({ children, eyebrow }: AuthShellProps) {
  return (
    <main className="min-h-svh bg-background text-foreground flex flex-col lg:flex-row">
      {/* ============= Left: form pane ============= */}
      <section className="relative flex flex-1 flex-col px-6 py-10 sm:px-10 lg:px-16 lg:py-12">
        {/* top row: brand mark + back link */}
        <header className="flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2.5 group"
            aria-label="Hierarchia home"
          >
            <BrandMark />
            <span className="text-base font-semibold tracking-tight">
              Hierarchia
            </span>
          </Link>

          <Link
            href="/"
            className="hidden sm:inline-flex text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Back to website
          </Link>
        </header>

        {/* form area — centered vertically in the available space */}
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-sm space-y-8">
            {eyebrow ? (
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                {eyebrow}
              </p>
            ) : null}
            {children}
          </div>
        </div>

        {/* footer */}
        <footer className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
          <span>
            &copy; {new Date().getFullYear()} Hierarchia. All rights reserved.
          </span>
          <nav className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-foreground transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">
              Terms
            </Link>
          </nav>
        </footer>
      </section>

      {/* ============= Right: brand pane (desktop only) ============= */}
      <aside
        aria-hidden="true"
        className="relative hidden lg:flex flex-1 overflow-hidden border-l border-border bg-secondary"
      >
        {/* soft tinted gradient backdrop */}
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,var(--accent)_0%,transparent_55%),radial-gradient(circle_at_80%_80%,var(--accent)_0%,transparent_50%)]"
        />

        {/* faint grid texture for depth — extremely subtle */}
        <div
          className="absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]"
          style={{
            backgroundImage:
              "linear-gradient(to right, color-mix(in srgb, var(--foreground) 6%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--foreground) 6%, transparent) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />

        {/* content */}
        <div className="relative z-10 flex flex-1 flex-col justify-between p-12 xl:p-16">
          {/* top: tagline */}
          <div className="max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              AI-driven hierarchy portal
            </p>
            <h2 className="mt-3 text-3xl xl:text-4xl font-semibold tracking-tight text-balance">
              One source of truth for managers and the teams they lead.
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground text-pretty">
              Announcements, AI-validated submissions, materials, analytics
              and automated reporting — unified in a single, calm workspace.
            </p>
          </div>

          {/* middle: hierarchy visual */}
          <div className="relative my-10 flex items-center justify-center">
            <HierarchyVisual className="w-full max-w-[420px] h-auto" />
          </div>

          {/* bottom: trust signals */}
          <ul className="grid gap-3 max-w-md">
            <TrustItem
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
              title="Role-aware access"
              description="Main admins, managers, and members see exactly what they should — nothing more."
            />
            <TrustItem
              icon={<Sparkles className="h-4 w-4" aria-hidden="true" />}
              title="AI-validated submissions"
              description="Smart AI checks every submission against your team's rules before it lands."
            />
            <TrustItem
              icon={<Users className="h-4 w-4" aria-hidden="true" />}
              title="Built for real teams"
              description="From two-person squads to org-wide rollouts with grounded reporting."
            />
          </ul>
        </div>
      </aside>
    </main>
  )
}

/**
 * Compact brand mark — a stack of three rounded bars suggesting the
 * three levels of an org chart. Drawn from the primary token so it
 * matches whatever theme is active.
 */
function BrandMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-card"
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      >
        {/* top bar */}
        <line x1="9" y1="6" x2="15" y2="6" />
        {/* middle bar */}
        <line x1="6" y1="12" x2="18" y2="12" />
        {/* bottom bar */}
        <line x1="4" y1="18" x2="20" y2="18" />
      </svg>
    </span>
  )
}

function TrustItem({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </span>
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="block text-xs text-muted-foreground leading-relaxed">
          {description}
        </span>
      </span>
    </li>
  )
}
