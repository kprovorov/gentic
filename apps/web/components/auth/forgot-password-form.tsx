"use client"

import { useState } from "react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"

import { createClient } from "@gentic/supabase/client"
import {
  forgotPasswordSchema,
  type ForgotPasswordValues,
} from "@gentic/validators/auth"
import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@gentic/ui/form"
import { Input } from "@gentic/ui/input"

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false)

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  })

  async function onSubmit(values: ForgotPasswordValues) {
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(
      values.email,
      {
        redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password`,
      },
    )

    if (error) {
      toast.error(error.message)
      return
    }

    setSent(true)
  }

  const isSubmitting = form.formState.isSubmitting

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-lg">Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a link to reset it
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <p className="text-center text-sm text-muted-foreground">
            If an account exists for that email, we&apos;ve sent a link to
            reset your password. Check your inbox.
          </p>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="grid gap-4"
            >
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        autoComplete="email"
                        placeholder="you@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="mt-2 w-full"
                disabled={isSubmitting}
              >
                {isSubmitting && <IconLoader2 className="animate-spin" />}
                Send reset link
              </Button>
            </form>
          </Form>
        )}
      </CardContent>
      <CardFooter className="justify-center border-t">
        <p className="text-sm text-muted-foreground">
          Remembered your password?{" "}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  )
}
