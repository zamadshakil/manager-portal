import LoginForm from "@/components/auth/login-form"

export default function LoginPage() {
  return (
    <main className="min-h-svh bg-background flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </main>
  )
}
