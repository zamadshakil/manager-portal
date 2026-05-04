"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Users, Loader2 } from "lucide-react"
import { createDepartment, updateDepartment, deleteDepartment } from "@/app/actions/departments"
import type { DepartmentWithStats } from "@/lib/data"

interface Props {
  department?: DepartmentWithStats
  onSuccess?: () => void
}

export function DepartmentForm({ department, onSuccess }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const isEditing = !!department

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    if (isEditing) {
      fd.set("id", department.id)
    }

    start(async () => {
      const res = isEditing ? await updateDepartment(fd) : await createDepartment(fd)
      if (!res.ok) {
        setError(res.error ?? "Failed to save department.")
        return
      }
      router.refresh()
      if (onSuccess) onSuccess()
      else if (!isEditing) router.push(`/dashboard/departments/${res.departmentId}`)
      else router.push("/dashboard/departments")
    })
  }

  return (
    <section className="rounded-xl border border-border bg-card shadow-card">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-primary">
          <Users className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">
            {isEditing ? "Edit department" : "Create new department"}
          </h2>
          <p className="text-[12px] text-muted-foreground">
            {isEditing
              ? "Update department details."
              : "Create a new department to group members, tasks, and validation rules."}
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="p-4 lg:p-5 space-y-4">
        <div className="grid gap-1.5">
          <label htmlFor="name" className="text-[12px] font-semibold text-muted-foreground">
            Department Name
          </label>
          <input
            id="name"
            name="name"
            required
            minLength={1}
            maxLength={100}
            defaultValue={department?.name ?? ""}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="e.g. Sales, Operations, Engineering"
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="description" className="text-[12px] font-semibold text-muted-foreground">
            Description (Optional)
          </label>
          <textarea
            id="description"
            name="description"
            rows={2}
            maxLength={500}
            defaultValue={department?.description ?? ""}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Short description of this department's role."
          />
        </div>

        {error ? (
          <p role="alert" className="text-[12.5px] font-semibold text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2">
          {isEditing ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                if (confirm("Are you sure you want to delete this department? All members will be unassigned.")) {
                  const fd = new FormData();
                  fd.set("id", department.id);
                  start(async () => {
                    const res = await deleteDepartment(fd);
                    if (!res.ok) setError(res.error ?? "Failed to delete department.");
                    else router.push("/dashboard/departments");
                  });
                }
              }}
              className="text-[12.5px] font-semibold text-destructive hover:underline disabled:opacity-50 text-left"
            >
              Delete department
            </button>
          ) : <div />}

          <div className="flex justify-end gap-2">
            {onSuccess && (
              <button
                type="button"
                onClick={onSuccess}
                className="rounded-xl border border-border bg-background px-3 h-9 text-[12px] font-semibold transition-colors hover:bg-muted"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 h-9 text-[13px] font-semibold text-primary-foreground transition-all hover:bg-[#005bab] active:scale-[0.97] disabled:opacity-60"
            >
              {pending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Saving…
                </>
              ) : isEditing ? (
                "Save changes"
              ) : (
                "Create department"
              )}
            </button>
          </div>
        </div>
      </form>
    </section>
  )
}
