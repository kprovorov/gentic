"use client"

import { ClerkProvider, useClerk, useWaitlist } from "@clerk/nextjs"
import { Button } from "@gentic/ui/button"
import { Input } from "@gentic/ui/input"
import { Label } from "@gentic/ui/label"
import { useState, type FormEvent } from "react"

const unavailableMessage =
  "Waitlist signup is temporarily unavailable. Please try again later."

function EmailForm({
  onSubmit,
  pending = false,
  loading = false,
  error,
}: {
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void
  pending?: boolean
  loading?: boolean
  error?: string
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-3 text-left"
      aria-busy={pending}
    >
      <Label htmlFor="waitlist-email">Email address</Label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          id="waitlist-email"
          name="emailAddress"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          required
          maxLength={254}
          readOnly={pending}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "waitlist-feedback" : undefined}
          className="h-10 bg-background"
        />
        <Button
          type="submit"
          size="lg"
          disabled={pending || loading || !onSubmit}
        >
          {pending ? "Joining…" : "Join waitlist"}
        </Button>
      </div>
      <div id="waitlist-feedback" aria-live="polite" aria-atomic="true">
        {error ? (
          <p role="alert" className="text-sm leading-6 text-destructive">
            {error}
          </p>
        ) : loading ? (
          <p className="text-sm leading-6 text-muted-foreground">
            Getting the form ready…
          </p>
        ) : null}
      </div>
    </form>
  )
}

function ConnectedWaitlistForm() {
  const { loaded } = useClerk()
  const { waitlist, errors } = useWaitlist()
  const [pending, setPending] = useState(false)
  const [joined, setJoined] = useState(false)
  const [error, setError] = useState<string>()

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!loaded || pending) return

    const emailAddress = String(
      new FormData(event.currentTarget).get("emailAddress") ?? "",
    ).trim()
    setPending(true)
    setError(undefined)
    try {
      const result = await waitlist.join({ emailAddress })
      if (result.error) {
        setError("Couldn’t join the waitlist. Please try again.")
      } else {
        setJoined(true)
      }
    } catch {
      setError("Couldn’t connect. Please check your connection and try again.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div aria-live="polite">
      {joined ? (
        <div role="status" className="rounded-3xl bg-background p-6 text-left">
          <p className="text-base font-medium">You’re on the waitlist.</p>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            We’ll email you when you’re invited to Gentic.
          </p>
        </div>
      ) : (
        <EmailForm
          onSubmit={handleSubmit}
          pending={pending}
          loading={!loaded}
          error={
            error ? errors.fields.emailAddress?.longMessage || error : undefined
          }
        />
      )}
    </div>
  )
}

export function WaitlistForm() {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY

  return (
    <div className="relative z-10 mx-auto mt-8 max-w-lg">
      {publishableKey ? (
        <ClerkProvider publishableKey={publishableKey} waitlistUrl="/#waitlist">
          <ConnectedWaitlistForm />
        </ClerkProvider>
      ) : (
        <EmailForm error={unavailableMessage} />
      )}
    </div>
  )
}
