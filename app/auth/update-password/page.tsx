import { Suspense } from "react"
import UpdatePasswordForm from "@/components/auth/update-password-form"
import Image from "next/image"

export const dynamic = "force-dynamic"

export default function UpdatePasswordPage() {
  return (
    <main className="relative min-h-svh flex items-center justify-center px-4 py-10 overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <Image
          src="/cloud-bg.png"
          alt="Cloud Background"
          fill
          className="object-cover opacity-90"
          priority
        />
        {/* Subtle overlay gradient to ensure readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-white/60 dark:from-background/60 dark:to-background/90" />
      </div>

      <div className="relative z-10 w-full max-w-[420px]">
        <Suspense fallback={null}>
          <UpdatePasswordForm />
        </Suspense>
      </div>
    </main>
  )
}
