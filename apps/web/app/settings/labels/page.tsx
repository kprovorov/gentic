import type { Metadata } from "next"

import { getSettingsLabelsData } from "@/app/queries"

import { SettingsLabelsView } from "./settings-labels-view"

export const metadata: Metadata = {
  title: "Labels",
  description: "Manage account labels.",
}

export default async function SettingsLabelsPage() {
  const initialData = await getSettingsLabelsData()

  return <SettingsLabelsView initialData={initialData} />
}
