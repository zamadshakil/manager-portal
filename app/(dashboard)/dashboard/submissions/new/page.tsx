import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { requireProfile } from "@/lib/auth"
import { PageHeader } from "@/components/dashboard/page-header"
import { UploadCard } from "@/components/dashboard/upload-card"

export const dynamic = "force-dynamic"

export default async function NewSubmissionPage() {
  await requireProfile()
  return (
    <>
      <Link
        href="/dashboard/submissions"
        className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to submissions
      </Link>
      <PageHeader
        title="New submission"
        description="Upload a document, image, or report. The LLM pipeline scores it against your team's validation rules within seconds."
      />
      <div className="max-w-2xl">
        <UploadCard />
      </div>
    </>
  )
}
