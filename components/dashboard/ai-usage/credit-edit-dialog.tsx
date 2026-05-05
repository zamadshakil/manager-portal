"use client"

import { useState, useTransition, useEffect } from "react"
import { Infinity as InfinityIcon, Save } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { AiCreditLimit, AiCreditPeriod } from "@/lib/types"
import { upsertCreditLimit } from "@/app/actions/ai-credits"

interface Props {
  user: AiCreditLimit
  open: boolean
  onClose: () => void
}

const PERIOD_OPTIONS: { value: AiCreditPeriod; label: string; description: string }[] = [
  { value: "daily", label: "Daily", description: "Resets every midnight" },
  { value: "weekly", label: "Weekly", description: "Resets every Monday" },
  { value: "monthly", label: "Monthly", description: "Resets on the 1st" },
]

export function CreditEditDialog({ user, open, onClose }: Props) {
  const [limit, setLimit] = useState(String(user.monthly_limit))
  const [period, setPeriod] = useState<AiCreditPeriod>(user.period_type)
  const [unlimited, setUnlimited] = useState(user.is_unlimited)
  const [notes, setNotes] = useState(user.notes ?? "")
  const [isPending, startTransition] = useTransition()

  // Sync when user changes (e.g. switching between rows without closing)
  useEffect(() => {
    setLimit(String(user.monthly_limit))
    setPeriod(user.period_type)
    setUnlimited(user.is_unlimited)
    setNotes(user.notes ?? "")
  }, [user])

  function handleSave() {
    const parsedLimit = parseInt(limit, 10)
    if (!unlimited && (isNaN(parsedLimit) || parsedLimit < 0)) {
      toast.error("Please enter a valid credit limit (0 or more)")
      return
    }
    startTransition(async () => {
      const res = await upsertCreditLimit({
        userId: user.user_id,
        limit: unlimited ? 999999 : parsedLimit,
        periodType: period,
        isUnlimited: unlimited,
        notes: notes.trim() || undefined,
      })
      if (res.ok) {
        toast.success(`Credits updated for ${user.user_full_name ?? user.user_email}`)
        onClose()
      } else {
        toast.error(res.error ?? "Failed to update credits")
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Edit AI Credits</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            {user.user_full_name ?? user.user_email}
            {user.user_role && (
              <span className="ml-1.5 capitalize text-xs bg-muted px-1.5 py-0.5 rounded-md">
                {user.user_role.replace("_", " ")}
              </span>
            )}
          </p>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Unlimited toggle */}
          <div className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div className="flex items-center gap-2.5">
              <InfinityIcon className="h-4 w-4 text-indigo-500" />
              <div>
                <p className="text-sm font-medium">Unlimited Access</p>
                <p className="text-xs text-muted-foreground">Bypass all credit limits</p>
              </div>
            </div>
            <Switch
              id="unlimited-toggle"
              checked={unlimited}
              onCheckedChange={setUnlimited}
            />
          </div>

          {/* Credit limit input */}
          <div className={unlimited ? "opacity-40 pointer-events-none" : ""}>
            <Label htmlFor="credit-limit" className="text-xs font-medium">
              Credit Limit (messages per period)
            </Label>
            <Input
              id="credit-limit"
              type="number"
              min={0}
              max={999999}
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className="mt-1.5 h-9"
              placeholder="100"
            />
          </div>

          {/* Period type */}
          <div className={unlimited ? "opacity-40 pointer-events-none" : ""}>
            <Label className="text-xs font-medium">Reset Period</Label>
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setPeriod(opt.value)}
                  className={`rounded-lg border p-2.5 text-left transition-all ${
                    period === opt.value
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:border-primary/50 hover:bg-muted/50"
                  }`}
                >
                  <p className="text-xs font-semibold">{opt.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{opt.description}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <Label htmlFor="credit-notes" className="text-xs font-medium">
              Admin Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <textarea
              id="credit-notes"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal note about this credit assignment…"
              className="mt-1.5 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {isPending ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
