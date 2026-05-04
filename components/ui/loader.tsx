"use client"

import { cn } from "@/lib/utils"

interface LoaderProps {
  className?: string
  size?: "sm" | "md" | "lg" | "xl"
  text?: string
}

export function Loader({ className, size = "md", text }: LoaderProps) {
  const sizes = {
    sm: "h-8 w-8",
    md: "h-14 w-14", // ~56px, fits the 50-60px spec
    lg: "h-24 w-24",
    xl: "h-32 w-32",
  }

  return (
    <div className={cn("relative flex flex-col items-center justify-center gap-4", className)}>
      <div className="relative flex items-center justify-center">
        {/* Gradient Spinner */}
        <div
          className={cn(
            "relative animate-spin rounded-full p-[3px]",
            sizes[size]
          )}
          style={{
            background: "conic-gradient(from 0deg, transparent 30%, #a855f7 70%, #3b82f6 100%)",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 4px), black 0)",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 4px), black 0)",
          }}
        />
        
        {/* Center Glow (Subtle) */}
        <div className={cn("absolute inset-0 bg-purple-500/10 blur-xl rounded-full animate-pulse", sizes[size])} />
      </div>

      {text && (
        <span className="text-[10px] font-bold tracking-[0.25em] text-white/80 uppercase animate-pulse">
          {text}
        </span>
      )}
    </div>
  )
}

export function FullPageLoader({ text }: { text?: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-transparent backdrop-blur-[10px] transition-all duration-1000 animate-in fade-in zoom-in-95">
      <Loader size="md" text={text || "AUTHENTICATING..."} />
    </div>
  )
}


