import type { Metadata } from "next"

import { getSettingsData } from "@/app/queries"

import { SettingsView } from "./settings-view"

export const metadata: Metadata = {
  title: "Projects",
  description: "Configure the repositories Gentic can assign coding agents to.",
}

export default async function SettingsPage() {
  const initialData = await getSettingsData()

  return <SettingsView initialData={initialData} />
}
