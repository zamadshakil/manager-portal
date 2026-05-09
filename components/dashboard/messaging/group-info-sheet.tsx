"use client"

import { useState } from "react"
import { UserMinus, UserPlus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import type { Conversation } from "@/lib/types"

interface GroupInfoSheetProps {
  open: boolean
  conversation: Conversation
  currentUserId: string
  onClose: () => void
  onClearHistory: () => void
}

export function GroupInfoSheet({ open, conversation, currentUserId, onClose, onClearHistory }: GroupInfoSheetProps) {
  const [removing, setRemoving] = useState<string | null>(null)
  const members = conversation.members ?? []

  const myRole = members.find((m) => m.user_id === currentUserId)?.role
  const isAdmin = myRole === "admin"

  const handleRemove = async (uid: string) => {
    setRemoving(uid)
    try {
      const res = await fetch(
        `/api/messaging/conversations/${conversation.id}/members/${uid}`,
        { method: "DELETE" },
      )
      if (!res.ok) throw new Error(await res.text())
      toast.success("Member removed")
    } catch {
      toast.error("Failed to remove member")
    } finally {
      setRemoving(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-80 p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="text-[15px]">
            {conversation.name ?? "Group"} · {members.length} members
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
          {members.map((m) => {
            const name = m.profile?.full_name ?? m.profile?.email ?? "Unknown"
            const initials = name.slice(0, 2).toUpperCase()
            const isSelf = m.user_id === currentUserId
            return (
              <div
                key={m.user_id}
                className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent/50"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={m.profile?.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium truncate">{name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{m.profile?.email}</p>
                </div>
                {m.role === "admin" && (
                  <Badge variant="secondary" className="text-[10px] h-4 px-1">Admin</Badge>
                )}
                {isAdmin && !isSelf && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    disabled={removing === m.user_id}
                    onClick={() => handleRemove(m.user_id)}
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {/* Danger zone */}
        <div className="px-3 py-3 border-t border-border">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
                Clear Chat History
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear chat history?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will remove the conversation history from your view only. All other participants will still see all messages.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => { onClearHistory(); onClose() }}
                >
                  Clear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </SheetContent>
    </Sheet>
  )
}
