"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { Users, UserPlus } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface TeamPageTabsProps {
  teamsSlot: React.ReactNode
  provisioningSlot: React.ReactNode
}

const TAB_VALUES = ["teams", "provisioning"] as const
type TabValue = (typeof TAB_VALUES)[number]

function isTabValue(value: string | null): value is TabValue {
  return value === "teams" || value === "provisioning"
}

export function TeamPageTabs({ teamsSlot, provisioningSlot }: TeamPageTabsProps) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const param = params.get("tab")
  const current: TabValue = isTabValue(param) ? param : "teams"

  function handleChange(next: string) {
    const sp = new URLSearchParams(params.toString())
    if (next === "teams") {
      sp.delete("tab")
    } else {
      sp.set("tab", next)
    }
    const qs = sp.toString()
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
  }

  return (
    <Tabs value={current} onValueChange={handleChange} className="gap-6">
      <TabsList className="h-10 p-1">
        <TabsTrigger value="teams" className="gap-1.5 px-3.5 text-[13px] font-semibold">
          <Users className="h-4 w-4" aria-hidden="true" />
          Teams
        </TabsTrigger>
        <TabsTrigger
          value="provisioning"
          className="gap-1.5 px-3.5 text-[13px] font-semibold"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          Provisioning
        </TabsTrigger>
      </TabsList>

      <TabsContent value="teams" className="mt-0">
        {teamsSlot}
      </TabsContent>
      <TabsContent value="provisioning" className="mt-0">
        {provisioningSlot}
      </TabsContent>
    </Tabs>
  )
}
