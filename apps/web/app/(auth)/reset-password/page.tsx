import type { Metadata } from "next"

import { ResetPasswordForm } from "@/components/auth/reset-password-form"

export const metadata: Metadata = {
  title: "Set a new password",
}

export default function ResetPasswordPage() {
  // The pending reset code is held client-side by Clerk's `useSignIn()`
  // after /forgot-password requests it — there's no server session to check
  // here, ResetPasswordForm verifies the code itself.
  return <ResetPasswordForm />
}
