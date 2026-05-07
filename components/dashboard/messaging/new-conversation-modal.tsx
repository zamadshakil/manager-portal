"use client"

import { useState } from "react"
import { Search } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { Conversation, Profile } from "@/lib/types"

interface NewConversationModalProps {
  open: boolean
  type: "dm" | "group"
  profiles: Profile[]
  currentUserId: string
  onClose: () => void
  onCreated: (conv: Conversation) => void
}

export function NewConversationModal({
  open,
  type,
  profiles,
  currentUserId,
  onClose,
  onCreated,
}: NewConversationModalProps) {
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<string[]>([])
  const [groupName, setGroupName] = useState("")
  const [loading, setLoading] = useState(false)

  const others = profiles.filter((p) => p.id !== currentUserId)
  const filtered = others.filter((p) =>
    (p.full_name ?? p.email).toLowerCase().includes(search.toLowerCase()),
  )

  const toggle = (id: string) => {
    if (type === "dm") {
      setSelected([id])
    } else {
      setSelected((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      )
    }
  }

  const handleCreate = async () => {
    if (selected.length === 0) return
    if (type === "group" && !groupName.trim()) {
      toast.error("Please enter a group name")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/messaging/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name: type === "group" ? groupName.trim() : undefined,
          memberIds: selected,
        }),
      })
      if (!res.ok) throw new Error(await res.text())
      const conv = await res.json()
      setSelected([])
      setGroupName("")
      setSearch("")
      onCreated(conv)
    } catch (err) {
      toast.error("Failed to create conversation")
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setSelected([])
    setGroupName("")
    setSearch("")
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{type === "dm" ? "New Direct Message" : "New Group Chat"}</DialogTitle>
        </DialogHeader>

        {type === "group" && (
          <div className="mb-2">
            <Label htmlFor="group-name" className="text-sm mb-1 block">Group name</Label>
            <Input
              id="group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="e.g. Project Alpha"
            />
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people…"
            className="pl-8"
          />
        </div>

        {/* People list */}
        <div className="max-h-60 overflow-y-auto space-y-0.5 mt-1 -mx-1">
          {filtered.map((p) => {
            const isSelected = selected.includes(p.id)
            const name = p.full_name ?? p.email
            const initials = name.slice(0, 2).toUpperCase()
            return (
              <button
                key={p.id}
                onClick={() => toggle(p.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-accent text-left transition-colors",
                  isSelected && "bg-accent",
                )}
              >
                {type === "group" ? (
                  <Checkbox checked={isSelected} className="shrink-0" />
                ) : null}
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarImage src={p.avatar_url ?? undefined} />
                  <AvatarFallback className="text-[11px]">{initials}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{p.email}</p>
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-center text-sm text-muted-foreground py-6">No people found</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleCreate} disabled={selected.length === 0 || loading}>
            {loading ? "Creating…" : type === "dm" ? "Open DM" : "Create Group"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
