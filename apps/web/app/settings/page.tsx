import type { Metadata } from "next"

import { getSettingsData } from "@/app/queries"

import { SettingsView } from "./settings-view"

export const metadata: Metadata = {
  title: "Projects",
  description: "Configure account settings.",
}

export default async function SettingsPage() {
  const initialData = await getSettingsData()

  return <SettingsView initialData={initialData} />
}
