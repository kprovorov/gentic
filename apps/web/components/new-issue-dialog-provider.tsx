"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { usePathname } from "next/navigation"

type NewIssueDialogContextValue = {
  open: boolean
  openDialog: () => void
  setOpen: (open: boolean) => void
}

const NewIssueDialogContext = createContext<NewIssueDialogContextValue | null>(
  null
)

export function NewIssueDialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const openDialog = useCallback(() => setOpen(true), [])
  const pathname = usePathname()
  const [lastPathname, setLastPathname] = useState(pathname)

  // A successful submission redirects to the created/updated issue's page.
  // Close the dialog whenever that navigation happens instead of leaving it
  // open on top of the new route. Adjusting state during render (rather than
  // in an effect) avoids an extra commit before the dialog closes.
  if (pathname !== lastPathname) {
    setLastPathname(pathname)
    if (open) {
      setOpen(false)
    }
  }

  const value = useMemo(
    () => ({ open, openDialog, setOpen }),
    [open, openDialog]
  )

  return (
    <NewIssueDialogContext.Provider value={value}>
      {children}
    </NewIssueDialogContext.Provider>
  )
}

export function useNewIssueDialog() {
  const context = useContext(NewIssueDialogContext)

  if (!context) {
    throw new Error(
      "useNewIssueDialog must be used within a NewIssueDialogProvider"
    )
  }

  return context
}
