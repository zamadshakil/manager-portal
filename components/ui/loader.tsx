"use client"

import { cn } from "@/lib/utils"

interface LoaderProps {
  className?: string
  size?: "sm" | "md" | "lg" | "xl"
  text?: string
}

export function Loader({ className, size = "md", text }: LoaderProps) {
  const sizes = {
    sm: "h-4 w-4 border-2",
    md: "h-8 w-8 border-3",
    lg: "h-12 w-12 border-4",
    xl: "h-16 w-16 border-4",
  }

  return (
    <div className={cn("flex flex-col items-center justify-center gap-4", className)}>
      <div className="relative">
        {/* Main rotating ring */}
        <div
          className={cn(
            "animate-spin rounded-full border-solid border-primary border-t-transparent",
            sizes[size]
          )}
        />
        {/* Subtle background ring */}
        <div
          className={cn(
            "absolute inset-0 rounded-full border-solid border-primary/10",
            sizes[size]
          )}
        />
      </div>
      {text && (
        <p className="animate-pulse text-sm font-medium text-muted-foreground tracking-tight">
          {text}
        </p>
      )}
    </div>
  )
}

export function FullPageLoader({ text }: { text?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-md transition-all duration-500 animate-in fade-in">
      <div className="relative flex flex-col items-center gap-8">
        {/* Decorative elements */}
        <div className="absolute -z-10 h-64 w-64 rounded-full bg-primary/5 blur-3xl animate-pulse" />
        
        <div className="relative group">
           {/* Outer Glow */}
           <div className="absolute -inset-4 bg-primary/20 rounded-full blur-xl opacity-50 group-hover:opacity-75 transition duration-1000 group-hover:duration-200 animate-pulse" />
           
           <Loader size="xl" />
        </div>

        {text && (
          <div className="flex flex-col items-center gap-2">
            <h3 className="text-xl font-semibold tracking-tight text-foreground">
              {text}
            </h3>
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-primary/40 animate-bounce" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
