"use client"

import { useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"

import {
  getSiteHeaderActionsSlot,
  getSiteHeaderActionsSlotServerSnapshot,
  subscribeSiteHeaderActionsSlot,
} from "@/components/site-header-actions-slot"

export function SiteHeaderPortal({ children }: { children: ReactNode }) {
  const container = useSyncExternalStore(
    subscribeSiteHeaderActionsSlot,
    getSiteHeaderActionsSlot,
    getSiteHeaderActionsSlotServerSnapshot
  )

  if (!container) {
    return null
  }

  return createPortal(children, container)
}
