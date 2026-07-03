"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useSignIn } from "@clerk/nextjs/legacy"
import { IconLoader2 } from "@tabler/icons-react"
import { toast } from "sonner"

import { clerkErrorMessage } from "@/lib/clerk-error"
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
  const router = useRouter()
  const { isLoaded, signIn } = useSignIn()

  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  })

  async function onSubmit(values: ForgotPasswordValues) {
    if (!isLoaded) {
      return
    }

    try {
      await signIn.create({
        strategy: "reset_password_email_code",
        identifier: values.email,
      })
      toast.success("Check your email for a reset code")
      router.push("/reset-password")
    } catch (error) {
      toast.error(clerkErrorMessage(error, "Unable to send a reset code"))
    }
  }

  const isSubmitting = form.formState.isSubmitting

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <CardTitle className="text-lg">Reset your password</CardTitle>
        <CardDescription>
          Enter your email and we&apos;ll send you a code to reset it
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-4">
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
              Send reset code
            </Button>
          </form>
        </Form>
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
