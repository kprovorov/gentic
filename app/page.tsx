import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Gentic",
}

export default function Page() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="max-w-2xl space-y-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">Gentic</p>
        <h1 className="text-4xl font-semibold tracking-normal">
          Manage coding agents from task to pull request.
        </h1>
        <p className="text-lg text-muted-foreground">
          Create tasks, assign them to agents, and follow the pull requests they
          open for review.
        </p>
      </div>
    </main>
  )
}
