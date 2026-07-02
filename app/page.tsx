import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Gentic",
}

export default function Page() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <h1 className="text-4xl font-semibold tracking-normal">Gentic</h1>
    </main>
  )
}
