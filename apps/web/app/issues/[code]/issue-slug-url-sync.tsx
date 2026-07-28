"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { useSupabaseClient } from "@gentic/supabase/client"

import type { IssueUrlParts } from "@/app/issues/urls"

import { getSyncedIssueHref } from "./issue-slug-url-sync-path"

type IssueSlugUrlSyncIssue = IssueUrlParts & {
  id: string
}

type IssueTitleRow = {
  title: string | null
}

export function IssueSlugUrlSync({ issue }: { issue: IssueSlugUrlSyncIssue }) {
  const [realtimeTitle, setRealtimeTitle] = useState<
    string | null | undefined
  >()
  const title = realtimeTitle === undefined ? issue.title : realtimeTitle
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = useSupabaseClient()

  useEffect(() => {
    const nextHref = getSyncedIssueHref(
      {
        ...issue,
        title,
      },
      pathname
    )

    if (!nextHref) {
      return
    }

    const queryString = searchParams.toString()
    router.replace(queryString ? `${nextHref}?${queryString}` : nextHref, {
      scroll: false,
    })
  }, [issue, pathname, router, searchParams, title])

  useEffect(() => {
    const channel = supabase
      .channel(`issue-${issue.id}-slug-url`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "issues",
          filter: `id=eq.${issue.id}`,
        },
        (payload) => {
          const next = parseIssueTitleRow(payload.new)
          if (!next) {
            return
          }
          setRealtimeTitle(next.title)
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [issue.id, supabase])

  return null
}

function parseIssueTitleRow(row: unknown): IssueTitleRow | null {
  if (!row || typeof row !== "object" || !("title" in row)) {
    return null
  }

  const title = row.title
  if (title !== null && typeof title !== "string") {
    return null
  }

  return { title }
}
