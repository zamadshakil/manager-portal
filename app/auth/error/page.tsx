import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function AuthErrorPage() {
  return (
    <main className="min-h-svh bg-background flex items-center justify-center px-4 py-10">
      <div className="max-w-sm text-center space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Authentication error</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          We could not complete your sign-in. Please try again or contact your administrator.
        </p>
        <Button asChild>
          <Link href="/auth/login">Back to sign in</Link>
        </Button>
      </div>
    </main>
  )
}
