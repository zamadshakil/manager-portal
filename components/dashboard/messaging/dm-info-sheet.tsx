"use client"

import { useState } from "react"
import { AlertTriangle, Mail, Trash2, User } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Conversation } from "@/lib/types"

interface DmInfoSheetProps {
  open: boolean
  conversation: Conversation
  currentUserId: string
  onClose: () => void
  onClearHistory?: () => void
  onHideConversation?: () => void
}

export function DmInfoSheet({ open, conversation, currentUserId, onClose, onClearHistory, onHideConversation }: DmInfoSheetProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const other = conversation.members?.find((m) => m.user_id !== currentUserId)
  const isDeleted = !!(other?.profile?.deleted_at || other?.profile?.email?.startsWith("deleted-"))
  const name = other?.profile?.full_name ?? (isDeleted ? "Deleted User" : (other?.profile?.email ?? "Unknown"))
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
            {!isDeleted && other?.profile?.email && (
              <p className="text-[12px] text-muted-foreground mt-0.5">{other.profile.email}</p>
            )}
          </div>
          {isDeleted ? (
            <Badge variant="outline" className="text-[11px] text-muted-foreground border-muted-foreground/40">
              Deleted account
            </Badge>
          ) : other?.role ? (
            <Badge variant="secondary" className="capitalize text-[11px]">
              {other.role}
            </Badge>
          ) : null}
        </div>

        {/* Details */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {isDeleted ? (
            <div className="flex items-start gap-3 rounded-lg bg-muted/50 border border-border px-3 py-3">
              <AlertTriangle className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-[12px] text-muted-foreground leading-relaxed">
                This account has been permanently removed. You can still view past messages.
              </p>
            </div>
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* Danger zone */}
        <div className="px-4 py-4 border-t border-border shrink-0 space-y-0.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Clear Chat History
          </Button>
          {onHideConversation && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => { onHideConversation(); onClose() }}
            >
              <Trash2 className="h-4 w-4" />
              Hide Conversation
            </Button>
          )}
        </div>
      </SheetContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear chat history?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all messages from your view. The other person will still see the full conversation history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                onClearHistory?.()
                onClose()
              }}
            >
              Clear History
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  )
}
