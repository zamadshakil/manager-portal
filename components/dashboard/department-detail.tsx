"use client"

import { useState, useTransition } from "react"
import { Users, UserCog, UserMinus, Plus, ShieldCheck, Loader2 } from "lucide-react"
import { 
  assignMemberToDepartment, 
  removeMemberFromDepartment, 
  setDepartmentManager 
} from "@/app/actions/departments"
import type { DepartmentWithStats } from "@/lib/data"
import type { Profile } from "@/lib/types"
import { roleLabel } from "@/lib/auth-shared"

interface Props {
  department: DepartmentWithStats
  members: Profile[]
  unassignedMembers: Profile[]
}

export function DepartmentDetail({ department, members, unassignedMembers }: Props) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  
  // Local state for UI toggles
  const [showAddMember, setShowAddMember] = useState(false)
  const [showSetManager, setShowSetManager] = useState(false)

  function handleAssignMember(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    fd.set("department_id", department.id)
    
    start(async () => {
      const res = await assignMemberToDepartment(fd)
      if (!res.ok) setError(res.error ?? "Failed to assign member.")
      else setShowAddMember(false)
    })
  }

  function handleRemoveMember(profileId: string) {
    setError(null)
    const fd = new FormData()
    fd.set("department_id", department.id)
    fd.set("profile_id", profileId)
    
    start(async () => {
      const res = await removeMemberFromDepartment(fd)
      if (!res.ok) setError(res.error ?? "Failed to remove member.")
    })
  }

  function handleSetManager(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    fd.set("department_id", department.id)
    
    start(async () => {
      const res = await setDepartmentManager(fd)
      if (!res.ok) setError(res.error ?? "Failed to set manager.")
      else setShowSetManager(false)
    })
  }

  return (
    <div className="space-y-6">
      {/* Manager Section */}
      <section className="rounded-xl border border-border bg-card shadow-card">
        <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <UserCog className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="mr-auto">
            <h2 className="text-[15px] font-semibold tracking-tight">Department Manager</h2>
            <p className="text-[12px] text-muted-foreground">
              The manager can configure validation rules and oversee tasks for this department.
            </p>
          </div>
          <button
            onClick={() => setShowSetManager((v) => !v)}
            className="rounded-xl border border-border bg-background px-3 h-8 text-[12px] font-semibold hover:bg-muted"
          >
            Change
          </button>
        </header>

        {showSetManager && (
          <form onSubmit={handleSetManager} className="border-b border-border bg-muted/20 p-4">
            <div className="flex items-end gap-3 max-w-lg">
              <div className="grid gap-1.5 flex-1">
                <label htmlFor="manager_select" className="text-[12px] font-semibold text-muted-foreground">
                  Select Manager
                </label>
                <select
                  id="manager_select"
                  name="profile_id"
                  defaultValue={department.manager_id ?? ""}
                  className="w-full rounded-md border border-border bg-background px-3 h-9 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">-- No Manager --</option>
                  <optgroup label="Current Members">
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name || m.email} ({roleLabel(m.role)})
                      </option>
                    ))}
                  </optgroup>
                  {unassignedMembers.length > 0 && (
                    <optgroup label="Unassigned Members">
                      {unassignedMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.full_name || m.email}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 h-9 text-[13px] font-semibold text-primary-foreground hover:bg-[#005bab] disabled:opacity-60"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Selecting a new manager will automatically grant them the Manager role and add them to this department if they aren't already.
            </p>
          </form>
        )}

        <div className="p-4 lg:p-5">
          {department.manager ? (
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-muted text-[13px] font-semibold">
                {(department.manager.full_name ?? department.manager.email).charAt(0).toUpperCase()}
              </span>
              <div>
                <p className="text-[13px] font-semibold">
                  {department.manager.full_name ?? department.manager.email}
                </p>
                <p className="text-[11.5px] text-muted-foreground">{department.manager.email}</p>
              </div>
              <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700">
                <ShieldCheck className="h-3 w-3" /> Active Manager
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-4 text-center">
              <p className="text-[13px] font-semibold text-muted-foreground">No manager assigned</p>
              <button 
                onClick={() => setShowSetManager(true)}
                className="mt-2 text-[12px] font-semibold text-primary hover:underline"
              >
                Assign a manager
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Members Section */}
      <section className="rounded-xl border border-border bg-card shadow-card">
        <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 lg:px-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f2f9ff] text-primary">
            <Users className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="mr-auto">
            <h2 className="text-[15px] font-semibold tracking-tight">Department Members</h2>
            <p className="text-[12px] text-muted-foreground">
              {members.length} {members.length === 1 ? "member" : "members"} in this department.
            </p>
          </div>
          <button
            onClick={() => setShowAddMember((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 h-8 text-[12px] font-semibold hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" /> Add member
          </button>
        </header>

        {showAddMember && (
          <form onSubmit={handleAssignMember} className="border-b border-border bg-muted/20 p-4">
            <div className="flex items-end gap-3 max-w-lg">
              <div className="grid gap-1.5 flex-1">
                <label htmlFor="member_select" className="text-[12px] font-semibold text-muted-foreground">
                  Select User
                </label>
                <select
                  id="member_select"
                  name="profile_id"
                  required
                  defaultValue=""
                  className="w-full rounded-md border border-border bg-background px-3 h-9 text-[13px] focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="" disabled>-- Select a user to add --</option>
                  {unassignedMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name || m.email} ({roleLabel(m.role)})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={pending}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 h-9 text-[13px] font-semibold text-primary-foreground hover:bg-[#005bab] disabled:opacity-60"
              >
                {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
              </button>
            </div>
            {unassignedMembers.length === 0 && (
              <p className="mt-2 text-[11px] text-destructive font-medium">
                No unassigned members available. You must provision a new user or remove one from another department first.
              </p>
            )}
          </form>
        )}

        {error && (
          <div className="border-b border-border px-4 py-2 bg-destructive/10">
            <p className="text-[12.5px] font-semibold text-destructive">{error}</p>
          </div>
        )}

        {members.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Users className="mx-auto h-8 w-8 text-muted-foreground opacity-50" aria-hidden="true" />
            <p className="mt-3 text-[13px] font-semibold">No members</p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Add members to start assigning tasks to them.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3 lg:px-5 hover:bg-muted/30">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-warm-white text-[12px] font-semibold">
                  {(m.full_name ?? m.email).charAt(0).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold truncate flex items-center gap-2">
                    {m.full_name ?? m.email}
                    {m.id === department.manager_id && (
                      <span className="text-[10px] font-bold tracking-wider text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded uppercase">Manager</span>
                    )}
                  </p>
                  <p className="text-[11.5px] text-muted-foreground truncate">
                    {m.email} · {roleLabel(m.role)}
                  </p>
                </div>
                {m.id !== department.manager_id && (
                  <button
                    onClick={() => handleRemoveMember(m.id)}
                    disabled={pending}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
                    title="Remove from department"
                  >
                    <UserMinus className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
