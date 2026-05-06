"use client"

import { useState } from "react"
import { Search, Download, ArrowUpDown, ChevronLeft, ChevronRight, CheckCircle2, XCircle } from "lucide-react"
import { format } from "date-fns"
import { Input } from "@/components/ui/input"

interface LedgerRow {
  id: string
  user_id: string
  user_email: string | null
  user_full_name: string | null
  team_name: string | null
  event_type: string
  model: string
  status: string
  credits_deducted: number
  created_at: string
}

interface Props {
  ledger: LedgerRow[]
}

export function TransactionLedger({ ledger }: Props) {
  const [searchTerm, setSearchTerm] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const itemsPerPage = 15

  // Filter
  const filtered = ledger.filter((row) => {
    if (!searchTerm) return true
    const term = searchTerm.toLowerCase()
    return (
      (row.user_full_name ?? "").toLowerCase().includes(term) ||
      (row.user_email ?? "").toLowerCase().includes(term) ||
      (row.team_name ?? "").toLowerCase().includes(term) ||
      row.event_type.toLowerCase().includes(term) ||
      row.model.toLowerCase().includes(term)
    )
  })

  // Pagination
  const totalPages = Math.ceil(filtered.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const paginated = filtered.slice(startIndex, startIndex + itemsPerPage)

  const downloadCSV = () => {
    const headers = [
      "Date",
      "User",
      "Email",
      "Department",
      "Event Type",
      "Model",
      "Status",
      "Credits Deducted",
    ]
    const rows = filtered.map((row) => [
      new Date(row.created_at).toISOString(),
      row.user_full_name ?? "Unknown",
      row.user_email ?? "Unknown",
      row.team_name ?? "None",
      row.event_type,
      row.model,
      row.status,
      row.credits_deducted.toString(),
    ])

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n")

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `ai_financial_report_${format(new Date(), "yyyy-MM-dd")}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const formatEventType = (type: string) => {
    return type
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users, departments, models..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setCurrentPage(1)
            }}
            className="pl-9"
          />
        </div>
        <button
          onClick={downloadCSV}
          className="flex items-center gap-2 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:text-indigo-800 border border-indigo-200 px-4 py-2 rounded-lg font-medium text-sm transition-colors w-full sm:w-auto justify-center"
        >
          <Download className="h-4 w-4" />
          Export Financial Report
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground font-medium border-b border-border">
              <tr>
                <th className="px-4 py-3">User Identity</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Event Type</th>
                <th className="px-4 py-3">Model Invoked</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Credits Deducted</th>
                <th className="px-4 py-3 text-right">Date &amp; Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No transactions found matching your search.
                  </td>
                </tr>
              ) : (
                paginated.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-foreground">{row.user_full_name ?? "Unknown"}</div>
                      <div className="text-xs text-muted-foreground">{row.user_email}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.team_name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground ring-1 ring-inset ring-border/20">
                        {formatEventType(row.event_type)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs font-mono">
                      {row.model}
                    </td>
                    <td className="px-4 py-3">
                      {row.status === "success" ? (
                        <div className="flex items-center gap-1.5 text-emerald-600">
                          <CheckCircle2 className="h-4 w-4" />
                          <span className="text-xs font-medium">Success</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-rose-600">
                          <XCircle className="h-4 w-4" />
                          <span className="text-xs font-medium">Failed</span>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-medium text-foreground">
                        {row.credits_deducted > 0 ? `-${row.credits_deducted}` : row.credits_deducted}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">
                      {format(new Date(row.created_at), "MMM d, h:mm a")}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-medium">{startIndex + 1}</span> to{" "}
            <span className="font-medium">
              {Math.min(startIndex + itemsPerPage, filtered.length)}
            </span>{" "}
            of <span className="font-medium">{filtered.length}</span> transactions
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="text-sm font-medium px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1 rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
