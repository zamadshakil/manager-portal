"use client"

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { TaskComposer } from "@/components/dashboard/task-composer"
import type { Profile, Team, ValidationRule } from "@/lib/types"

interface NewTaskDialogProps {
  teams: Team[]
  defaultTeamId: string | null
  members: Profile[]
  rules: ValidationRule[]
}

export function NewTaskDialog({ teams, defaultTeamId, members, rules }: NewTaskDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <Plus className="h-4 w-4" aria-hidden="true" />
        New Task
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-2xl max-h-[92vh] overflow-y-auto p-0"
          showCloseButton={true}
        >
          <DialogTitle className="sr-only">Create new task</DialogTitle>
          <TaskComposer
            teams={teams}
            defaultTeamId={defaultTeamId}
            members={members}
            rules={rules}
            onSuccess={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
