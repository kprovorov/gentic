"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useSelectedLayoutSegments } from "next/navigation"

import { shouldDeferRouteRefresh } from "./realtime-refresh-mode"

const RealtimeRouteRefreshContext = createContext(false)

export function RealtimeRouteRefreshBoundary({
  children,
}: {
  children: ReactNode
}) {
  const modalSegments = useSelectedLayoutSegments("modal")
  const shouldDefer = useMemo(
    () => shouldDeferRouteRefresh(null, modalSegments),
    [modalSegments]
  )

  return (
    <RealtimeRouteRefreshContext.Provider value={shouldDefer}>
      {children}
    </RealtimeRouteRefreshContext.Provider>
  )
}

export function useShouldDeferRealtimeRouteRefresh(
  pathname: string | null | undefined
) {
  return useContext(RealtimeRouteRefreshContext) || shouldDeferRouteRefresh(pathname)
}
