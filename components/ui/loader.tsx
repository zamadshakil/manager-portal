"use client"

import { cn } from "@/lib/utils"

interface LoaderProps {
  className?: string
  size?: "sm" | "md" | "lg" | "xl"
  text?: string
}

export function Loader({ className, size = "md", text }: LoaderProps) {
  const sizes = {
    sm: "h-12 w-12",
    md: "h-24 w-24",
    lg: "h-32 w-32",
    xl: "h-40 w-40",
  }

  return (
    <div className={cn("relative flex items-center justify-center", className)}>
      {/* Gradient Spinner */}
      <div
        className={cn(
          "relative animate-spin rounded-full p-[4px]",
          sizes[size]
        )}
        style={{
          background: "conic-gradient(from 0deg, transparent 30%, #a855f7 70%, #3b82f6 100%)",
          WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 8px), black 0)",
          mask: "radial-gradient(farthest-side, transparent calc(100% - 8px), black 0)",
        }}
      />
      
      {/* Center Text */}
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-[10px] font-bold tracking-[0.2em] text-white uppercase opacity-90">
          {text || "LOADING"}
        </span>
      </div>

      {/* Decorative Glow */}
      <div className={cn("absolute -inset-4 bg-purple-500/20 blur-2xl rounded-full animate-pulse", sizes[size])} />
    </div>
  )
}

export function FullPageLoader({ text }: { text?: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/60 backdrop-blur-2xl transition-all duration-700 animate-in fade-in">
      <div className="relative flex flex-col items-center gap-12 scale-110 lg:scale-125">
        <Loader size="xl" text={text} />
      </div>
    </div>
  )
}

