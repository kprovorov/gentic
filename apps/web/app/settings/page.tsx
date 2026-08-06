import type { Metadata } from "next"

import { getSettingsData } from "@/app/queries"

import { SettingsView } from "./settings-view"

export const metadata: Metadata = {
  title: "Projects",
  description: "Configure account settings.",
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ github?: string | string[] }>
}) {
  const githubResult = (await searchParams).github
  const initialData = await getSettingsData()

  return (
    <SettingsView
      initialData={initialData}
      githubConnectionConflict={githubResult === "installation-conflict"}
    />
  )
}
