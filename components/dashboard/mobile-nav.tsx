import { LayoutDashboard, Megaphone, FolderOpen, Upload, BarChart3 } from "lucide-react"
import { cn } from "@/lib/utils"

const items = [
  { label: "Overview", icon: LayoutDashboard, href: "#overview", active: true },
  { label: "News", icon: Megaphone, href: "#announcements" },
  { label: "Files", icon: FolderOpen, href: "#materials" },
  { label: "Submit", icon: Upload, href: "#submissions" },
  { label: "Reports", icon: BarChart3, href: "#reports" },
]

export function MobileNav() {
  return (
    <nav
      aria-label="Mobile navigation"
      className="lg:hidden fixed bottom-0 left-0 right-0 z-30 border-t border-border bg-background/95 backdrop-blur-md"
    >
      <ul className="grid grid-cols-5">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.label}>
              <a
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2.5 text-[10.5px] font-semibold transition-colors",
                  item.active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
                aria-current={item.active ? "page" : undefined}
              >
                <Icon className="h-[18px] w-[18px]" />
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
