import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { IconArrowLeft, IconDeviceFloppy } from "@tabler/icons-react"

import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { Input } from "@gentic/ui/input"
import { Label } from "@gentic/ui/label"
import { createClient } from "@gentic/supabase/server"

import { updateIssue } from "@/app/issues/actions"

type Issue = {
  id: string
  title: string
  prompt: string | null
}

export default async function EditIssuePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    redirect("/login")
  }

  const { data: issue, error } = await supabase
    .from("issues")
    .select("id,title,prompt")
    .eq("id", id)
    .maybeSingle()
    .returns<Issue | null>()

  if (error) {
    throw new Error(error.message)
  }

  if (!issue) {
    notFound()
  }

  return (
    <main className="min-h-svh bg-background px-4 py-8 md:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6">
          <Button asChild variant="ghost" className="w-fit">
            <Link href={`/issues/${issue.id}`}>
              <IconArrowLeft />
              Back
            </Link>
          </Button>
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Issues</p>
            <h1 className="text-3xl">Edit issue</h1>
          </div>
        </header>

        <Card>
          <CardHeader>
            <CardTitle>Edit issue</CardTitle>
            <CardDescription>Update the title and prompt.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={updateIssue} className="grid gap-5">
              <input type="hidden" name="id" value={issue.id} />

              <div className="grid gap-2">
                <Label htmlFor="issue-title">Title</Label>
                <Input
                  id="issue-title"
                  name="title"
                  defaultValue={issue.title}
                  placeholder="Review onboarding flow"
                  required
                  maxLength={160}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="issue-prompt">Prompt</Label>
                <textarea
                  id="issue-prompt"
                  name="prompt"
                  rows={6}
                  defaultValue={issue.prompt ?? ""}
                  placeholder="Add context, acceptance notes, or links."
                  className="w-full resize-y rounded-3xl border border-transparent bg-input/50 px-3 py-2 text-base transition-[color,box-shadow,background-color] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 md:text-sm"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button asChild variant="outline">
                  <Link href={`/issues/${issue.id}`}>Cancel</Link>
                </Button>
                <Button type="submit">
                  <IconDeviceFloppy />
                  Save changes
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
