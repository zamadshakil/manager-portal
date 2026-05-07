"use client"

import type { TypingUser } from "@/lib/types"

interface TypingIndicatorProps {
  users: TypingUser[]
}

export function TypingIndicator({ users }: TypingIndicatorProps) {
  if (users.length === 0) return null

  const names =
    users.length === 1
      ? `${users[0].name} is typing`
      : users.length === 2
        ? `${users[0].name} and ${users[1].name} are typing`
        : "Several people are typing"

  return (
    <div className="px-4 py-1 flex items-center gap-2 text-[12px] text-muted-foreground">
      <span className="flex gap-0.5 items-end h-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-muted-foreground animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      <span>{names}…</span>
    </div>
  )
}
