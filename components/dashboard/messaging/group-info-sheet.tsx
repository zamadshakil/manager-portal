"use client"

import { useState, useEffect, useRef } from "react"
import { UserMinus, Trash2, Pencil, Check, X, Camera } from "lucide-react"
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
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import type { Conversation, ConversationMember } from "@/lib/types"

interface GroupInfoSheetProps {
  open: boolean
  conversation: Conversation
  currentUserId: string
  onClose: () => void
  onClearHistory?: () => void
  onGroupUpdated?: (patch: Partial<Pick<Conversation, "name" | "avatar_url">>) => void
}

export function GroupInfoSheet({ open, conversation, currentUserId, onClose, onClearHistory, onGroupUpdated }: GroupInfoSheetProps) {
  const [localMembers, setLocalMembers] = useState<ConversationMember[]>(conversation.members ?? [])
  const [removing, setRemoving] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(conversation.name ?? "")
  const [savingName, setSavingName] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(conversation.avatar_url ?? undefined)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset local state every time the sheet opens
  useEffect(() => {
    if (!open) return
    setLocalMembers(conversation.members ?? [])
    setNameValue(conversation.name ?? "")
    setAvatarUrl(conversation.avatar_url ?? undefined)
    setEditingName(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const myRole = localMembers.find((m) => m.user_id === currentUserId)?.role
  const isAdmin = myRole === "admin"
  const displayName = nameValue.trim() || "Group"
  const initials = displayName.slice(0, 2).toUpperCase()

  const handleRemove = async (uid: string) => {
    setRemoving(uid)
    try {
      const res = await fetch(
        `/api/messaging/conversations/${conversation.id}/members/${uid}`,
        { method: "DELETE" },
      )
      if (!res.ok) throw new Error(await res.text())
      setLocalMembers((prev) => prev.filter((m) => m.user_id !== uid))
      toast.success("Member removed")
    } catch {
      toast.error("Failed to remove member")
    } finally {
      setRemoving(null)
    }
  }

  const handleSaveName = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed) return
    setSavingName(true)
    try {
      const res = await fetch(`/api/messaging/conversations/${conversation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) throw new Error(await res.text())
      setEditingName(false)
      onGroupUpdated?.({ name: trimmed })
      toast.success("Group name updated")
    } catch {
      toast.error("Failed to update group name")
    } finally {
      setSavingName(false)
    }
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file")
      return
    }
    setUploadingAvatar(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/messaging/conversations/${conversation.id}/avatar`, {
        method: "POST",
        body: fd,
      })
      if (!res.ok) throw new Error(await res.text())
      const { url } = await res.json()
      setAvatarUrl(url)
      onGroupUpdated?.({ avatar_url: url })
      toast.success("Group icon updated")
    } catch {
      toast.error("Failed to update group icon")
    } finally {
      setUploadingAvatar(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-80 p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border">
          <SheetTitle className="text-[15px]">Group Info</SheetTitle>
        </SheetHeader>

        {/* Hero section — mirrors DmInfoSheet layout */}
        <div className="flex flex-col items-center gap-3 pt-8 pb-6 px-4 border-b border-border">
          <div className="relative">
            <Avatar className="h-20 w-20">
              <AvatarImage src={avatarUrl} />
              <AvatarFallback className="text-2xl font-semibold">{initials}</AvatarFallback>
            </Avatar>
            {isAdmin && (
              <button
                className="absolute bottom-0 right-0 rounded-full bg-primary text-primary-foreground p-1.5 shadow-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                title="Change group icon"
              >
                <Camera className="h-3 w-3" />
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>

          {/* Editable group name */}
          {editingName ? (
            <div className="flex items-center gap-1 w-full max-w-55">
              <Input
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                className="h-8 text-sm text-center"
                autoFocus
                maxLength={120}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleSaveName()
                  if (e.key === "Escape") { setEditingName(false); setNameValue(conversation.name ?? "") }
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => void handleSaveName()}
                disabled={savingName}
              >
                <Check className="h-3.5 w-3.5 text-green-500" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => { setEditingName(false); setNameValue(conversation.name ?? "") }}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <p className="text-[16px] font-semibold leading-tight">{displayName}</p>
              {isAdmin && (
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setEditingName(true)}
                  title="Edit group name"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
          <p className="text-[12px] text-muted-foreground">{localMembers.length} members</p>
        </div>

        {/* Members list */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
          {localMembers.map((m) => {
            const name = m.profile?.full_name ?? m.profile?.email ?? "Unknown"
            const memberInitials = name.slice(0, 2).toUpperCase()
            const isSelf = m.user_id === currentUserId
            return (
              <div
                key={m.user_id}
                className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent/50"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={m.profile?.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[11px]">{memberInitials}</AvatarFallback>
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
                    onClick={() => void handleRemove(m.user_id)}
                  >
                    <UserMinus className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        {/* Danger zone */}
        <div className="px-3 py-3 border-t border-border shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Clear Chat History
          </Button>
        </div>
      </SheetContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear chat history?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all messages from your view. Other members will still see the full conversation history.
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
