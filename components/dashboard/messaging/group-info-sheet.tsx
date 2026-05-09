"use client"

import { useState, useEffect, useRef } from "react"
import { UserMinus, Trash2, Pencil, Check, X, Camera, UserPlus, Search, ChevronDown, ChevronUp, UserX, RotateCcw } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
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
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import type { Conversation, ConversationMember, Profile } from "@/lib/types"

interface GroupInfoSheetProps {
  open: boolean
  conversation: Conversation
  currentUserId: string
  profiles: Profile[]
  onClose: () => void
  onClearHistory?: () => void
  onGroupUpdated?: (patch: Partial<Pick<Conversation, "name" | "avatar_url">>) => void
  onHideConversation?: () => void
}

export function GroupInfoSheet({ open, conversation, currentUserId, profiles, onClose, onClearHistory, onGroupUpdated, onHideConversation }: GroupInfoSheetProps) {
  // Active members: not removed and profile not deleted
  const [localMembers, setLocalMembers] = useState<ConversationMember[]>([])
  // Former members: those who were removed from the group
  const [formerMembers, setFormerMembers] = useState<ConversationMember[]>([])
  const [removing, setRemoving] = useState<string | null>(null)
  const [readding, setReadding] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState(conversation.name ?? "")
  const [savingName, setSavingName] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(conversation.avatar_url ?? undefined)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Add-members panel state
  const [addingMembers, setAddingMembers] = useState(false)
  const [addSearch, setAddSearch] = useState("")
  const [addSelected, setAddSelected] = useState<string[]>([])
  const [savingAdd, setSavingAdd] = useState(false)

  // Former members collapsible
  const [formerExpanded, setFormerExpanded] = useState(false)

  // Reset local state every time the sheet opens
  useEffect(() => {
    if (!open) return
    const allMembers = conversation.members ?? []
    setLocalMembers(allMembers.filter((m) => !m.removed_at && !m.profile?.deleted_at))
    setFormerMembers(conversation.removed_members ?? [])
    setNameValue(conversation.name ?? "")
    setAvatarUrl(conversation.avatar_url ?? undefined)
    setEditingName(false)
    setAddingMembers(false)
    setAddSearch("")
    setAddSelected([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const myRole = localMembers.find((m) => m.user_id === currentUserId)?.role
  const isAdmin = myRole === "admin"
  const displayName = nameValue.trim() || "Group"
  const initials = displayName.slice(0, 2).toUpperCase()

  // Profiles eligible to be added: not already an active member, not deleted
  const activeMemberIds = new Set(localMembers.map((m) => m.user_id))
  const addableProfiles = profiles.filter(
    (p) => !activeMemberIds.has(p.id) && !p.deleted_at,
  )
  const filteredAddable = addableProfiles.filter((p) =>
    (p.full_name ?? p.email).toLowerCase().includes(addSearch.toLowerCase()),
  )

  const handleRemove = async (uid: string) => {
    setRemoving(uid)
    try {
      const res = await fetch(
        `/api/messaging/conversations/${conversation.id}/members/${uid}`,
        { method: "DELETE" },
      )
      if (!res.ok) throw new Error(await res.text())
      // Move member from active to former list optimistically
      setLocalMembers((prev) => {
        const removed = prev.find((m) => m.user_id === uid)
        if (removed) {
          setFormerMembers((f) => [
            { ...removed, removed_at: new Date().toISOString() },
            ...f,
          ])
        }
        return prev.filter((m) => m.user_id !== uid)
      })
      toast.success("Member removed")
    } catch {
      toast.error("Failed to remove member")
    } finally {
      setRemoving(null)
    }
  }

  const handleReadd = async (uid: string) => {
    setReadding(uid)
    try {
      const res = await fetch(
        `/api/messaging/conversations/${conversation.id}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: [uid] }),
        },
      )
      if (!res.ok) throw new Error(await res.text())
      // Move member from former back to active list optimistically
      setFormerMembers((prev) => {
        const member = prev.find((m) => m.user_id === uid)
        if (member) {
          setLocalMembers((a) => [
            ...a,
            { ...member, removed_at: null, role: "member" },
          ])
        }
        return prev.filter((m) => m.user_id !== uid)
      })
      toast.success("Member re-added")
    } catch {
      toast.error("Failed to re-add member")
    } finally {
      setReadding(null)
    }
  }

  const handleAddMembers = async () => {
    if (addSelected.length === 0) return
    setSavingAdd(true)
    try {
      const res = await fetch(
        `/api/messaging/conversations/${conversation.id}/members`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: addSelected }),
        },
      )
      if (!res.ok) throw new Error(await res.text())
      // Optimistically add selected profiles to local members
      const newMembers: ConversationMember[] = addSelected
        .map((id) => {
          const p = profiles.find((x) => x.id === id)
          if (!p) return null
          return {
            conversation_id: conversation.id,
            user_id: p.id,
            role: "member" as const,
            joined_at: new Date().toISOString(),
            last_read_at: new Date().toISOString(),
            removed_at: null,
            profile: {
              id: p.id,
              full_name: p.full_name,
              email: p.email,
              avatar_url: p.avatar_url,
              deleted_at: null,
            },
          }
        })
        .filter(Boolean) as ConversationMember[]
      // Also clear them from formerMembers in case they were previously removed
      const addedIds = new Set(addSelected)
      setFormerMembers((prev) => prev.filter((m) => !addedIds.has(m.user_id)))
      setLocalMembers((prev) => {
        const existingIds = new Set(prev.map((m) => m.user_id))
        return [...prev, ...newMembers.filter((m) => !existingIds.has(m.user_id))]
      })
      toast.success(`${newMembers.length} member${newMembers.length !== 1 ? "s" : ""} added`)
      setAddingMembers(false)
      setAddSearch("")
      setAddSelected([])
    } catch {
      toast.error("Failed to add members")
    } finally {
      setSavingAdd(false)
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

        {/* Hero section */}
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

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Add Members panel (admin only) ── */}
          {isAdmin && (
            <div className="px-3 pt-3">
              {addingMembers ? (
                <div className="rounded-xl border border-border bg-muted/30 overflow-hidden">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                    <p className="text-[13px] font-semibold">Add members</p>
                    <button
                      onClick={() => { setAddingMembers(false); setAddSearch(""); setAddSelected([]) }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="px-3 pt-2 pb-1">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                      <Input
                        value={addSearch}
                        onChange={(e) => setAddSearch(e.target.value)}
                        placeholder="Search people…"
                        className="h-8 pl-7 text-xs"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-44 overflow-y-auto px-1 pb-1">
                    {filteredAddable.length === 0 ? (
                      <p className="text-center text-[12px] text-muted-foreground py-4">
                        {addSearch ? "No results" : "Everyone is already in this group"}
                      </p>
                    ) : (
                      filteredAddable.map((p) => {
                        const name = p.full_name ?? p.email
                        const ini = name.slice(0, 2).toUpperCase()
                        const checked = addSelected.includes(p.id)
                        return (
                          <button
                            key={p.id}
                            onClick={() =>
                              setAddSelected((prev) =>
                                prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                              )
                            }
                            className={cn(
                              "w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-accent text-left transition-colors",
                              checked && "bg-accent",
                            )}
                          >
                            <Checkbox checked={checked} className="shrink-0 h-3.5 w-3.5" />
                            <Avatar className="h-7 w-7 shrink-0">
                              <AvatarImage src={p.avatar_url ?? undefined} />
                              <AvatarFallback className="text-[10px]">{ini}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="text-[12px] font-medium truncate">{name}</p>
                              <p className="text-[10px] text-muted-foreground truncate">{p.email}</p>
                            </div>
                          </button>
                        )
                      })
                    )}
                  </div>
                  {addSelected.length > 0 && (
                    <div className="px-3 pb-2.5">
                      <Button
                        size="sm"
                        className="w-full h-7 text-xs"
                        onClick={() => void handleAddMembers()}
                        disabled={savingAdd}
                      >
                        {savingAdd ? "Adding…" : `Add ${addSelected.length} member${addSelected.length !== 1 ? "s" : ""}`}
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs gap-1.5 mb-1"
                  onClick={() => setAddingMembers(true)}
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  Add members
                </Button>
              )}
            </div>
          )}

          {/* ── Active members list ── */}
          <div className="px-3 pt-2 pb-1 space-y-0.5">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-1">
              Members ({localMembers.length})
            </p>
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
                    <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0">Admin</Badge>
                  )}
                  {isAdmin && !isSelf && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                      disabled={removing === m.user_id}
                      title="Remove from group"
                      onClick={() => void handleRemove(m.user_id)}
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── Former Members section ── */}
          {formerMembers.length > 0 && (
            <div className="px-3 pt-2 pb-2">
              <button
                onClick={() => setFormerExpanded((v) => !v)}
                className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-1.5">
                  <UserX className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    Former members ({formerMembers.length})
                  </p>
                </div>
                {formerExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                )}
              </button>

              {formerExpanded && (
                <div className="mt-1 space-y-0.5">
                  {formerMembers.map((m) => {
                    const name = m.profile?.full_name ?? m.profile?.email ?? "Unknown"
                    const memberInitials = name.slice(0, 2).toUpperCase()
                    const removedAgo = m.removed_at
                      ? formatDistanceToNow(new Date(m.removed_at), { addSuffix: true })
                      : null
                    return (
                      <div
                        key={m.user_id}
                        className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-accent/30 opacity-70"
                      >
                        <Avatar className="h-8 w-8 shrink-0">
                          <AvatarImage src={m.profile?.avatar_url ?? undefined} />
                          <AvatarFallback className="text-[11px]">{memberInitials}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium truncate line-through decoration-muted-foreground/50">{name}</p>
                          {removedAgo && (
                            <p className="text-[10px] text-muted-foreground truncate">Removed {removedAgo}</p>
                          )}
                        </div>
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-muted-foreground hover:text-primary shrink-0"
                            disabled={readding === m.user_id}
                            title="Re-add to group"
                            onClick={() => void handleReadd(m.user_id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Danger zone */}
        <div className="px-3 py-3 border-t border-border shrink-0 space-y-0.5">
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
              <UserMinus className="h-4 w-4" />
              Delete Conversation
            </Button>
          )}
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
