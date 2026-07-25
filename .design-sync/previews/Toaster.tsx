import { useEffect } from "react"
import { toast } from "sonner"
import { Toaster } from "@gentic/ui"

export function Success() {
  useEffect(() => {
    toast.success("Pull request #482 opened for review")
  }, [])

  return (
    <div style={{ width: 320, height: 80 }}>
      <Toaster position="top-right" />
    </div>
  )
}

export function Error() {
  useEffect(() => {
    toast.error("Failed to assign agent — repo access revoked")
  }, [])

  return (
    <div style={{ width: 320, height: 80 }}>
      <Toaster position="top-right" />
    </div>
  )
}
