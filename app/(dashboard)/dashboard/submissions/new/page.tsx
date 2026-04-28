import { redirect } from "next/navigation"

// Submissions are now task-driven — there is no ad-hoc upload path.
// Anyone landing on the legacy URL gets bounced to their task list.
export default function LegacyNewSubmissionRedirect() {
  redirect("/dashboard/tasks")
}
