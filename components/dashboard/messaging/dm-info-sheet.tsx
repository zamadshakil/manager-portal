"use client"

import { Mail, User } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import type { Conversation } from "@/lib/types"

interface DmInfoSheetProps {
  open: boolean
  conversation: Conversation
  currentUserId: string
  onClose: () => void
}

export function DmInfoSheet({ open, conversation, currentUserId, onClose }: DmInfoSheetProps) {
  const other = conversation.members?.find((m) => m.user_id !== currentUserId)
  const name = other?.profile?.full_name ?? other?.profile?.email ?? "Unknown"
  const initials = name.slice(0, 2).toUpperCase()

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-80 p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="text-[15px]">Contact Info</SheetTitle>
        </SheetHeader>

        {/* Profile hero */}
        <div className="flex flex-col items-center gap-3 pt-8 pb-6 px-4 border-b border-border">
          <Avatar className="h-20 w-20">
            <AvatarImage src={other?.profile?.avatar_url ?? undefined} />
            <AvatarFallback className="text-2xl font-semibold">{initials}</AvatarFallback>
          </Avatar>
          <div className="text-center">
            <p className="text-[16px] font-semibold leading-tight">{name}</p>
            {other?.profile?.email && (
              <p className="text-[12px] text-muted-foreground mt-0.5">{other.profile.email}</p>
            )}
          </div>
          {other?.role && (
            <Badge variant="secondary" className="capitalize text-[11px]">
              {other.role}
            </Badge>
          )}
        </div>

        {/* Details */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {other?.profile?.full_name && (
            <div className="flex items-start gap-3">
              <User className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">
                  Full Name
                </p>
                <p className="text-sm">{other.profile.full_name}</p>
              </div>
            </div>
          )}
          {other?.profile?.email && (
            <div className="flex items-start gap-3">
              <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-0.5">
                  Email
                </p>
                <p className="text-sm break-all">{other.profile.email}</p>
              </div>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
