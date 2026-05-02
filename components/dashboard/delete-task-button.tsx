"use client"

import { useTransition, useState } from "react"
import { useRouter } from "next/navigation"
import { Trash2, Loader2 } from "lucide-react"
import { deleteTask } from "@/app/actions/tasks"
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

export function DeleteTaskButton({ taskId, iconOnly }: { taskId: string; iconOnly?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [open, setOpen] = useState(false)

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault() // prevent closing dialog instantly if we want to show loading
    e.stopPropagation() // prevent bubbling to <Link>
    
    start(async () => {
      const formData = new FormData()
      formData.append("id", taskId)
      
      const res = await deleteTask(formData)
      if (res.ok) {
        setOpen(false)
        router.push("/dashboard/tasks")
      } else {
        alert(res.error || "Failed to delete task")
        setOpen(false)
      }
    })
  }

  const trigger = iconOnly ? (
    <button
      disabled={pending}
      title="Delete task"
      className="flex items-center justify-center p-2 rounded-lg hover:bg-destructive/10 text-destructive/70 hover:text-destructive disabled:opacity-50 transition-colors"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
    </button>
  ) : (
    <button
      disabled={pending}
      className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-destructive hover:text-destructive/80 disabled:opacity-50 transition-colors"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="h-3.5 w-3.5" />
      )}
      {pending ? "Deleting..." : "Delete task"}
    </button>
  )

  return (
    <div onClick={(e) => {
      // Prevent clicks from bubbling up to parent Link elements
      e.preventDefault()
      e.stopPropagation()
    }}>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          {trigger}
        </AlertDialogTrigger>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete this task
              and remove all associated assignments and data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete}
              disabled={pending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {pending ? (
                <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin"/> Deleting...</span>
              ) : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
