import { Loader } from "@/components/ui/loader"

export default function Loading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-50">
      <Loader size="lg" text="Loading..." />
    </div>
  )
}
