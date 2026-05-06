"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

export function AssignmentsRealtimeListener({ taskId }: { taskId: string }) {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    
    // Listen for changes to task_assignments for this task (status, submission linkage)
    const channelA = supabase
      .channel(`task-assignments-${taskId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "task_assignments", filter: `task_id=eq.${taskId}` },
        () => {
          router.refresh()
        }
      )
      .subscribe()

    // Listen for changes to submissions for this task (AI validation score, summary updates)
    const channelS = supabase
      .channel(`task-submissions-${taskId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submissions", filter: `task_id=eq.${taskId}` },
        () => {
          router.refresh()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channelA)
      void supabase.removeChannel(channelS)
    }
  }, [taskId, router])

  return null
}
