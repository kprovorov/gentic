"use client"

import { useEffect, useRef, useState } from "react"

import { useSupabaseClient } from "@gentic/supabase/client"
import {
  REALTIME_MESSAGE_EVENT,
  reviewRunLogEventSchema,
  reviewRunRealtimeTopic,
} from "@gentic/validators/realtime"

import { listReviewRunLogsAction } from "../actions"

export type ReviewRunLogEntry = {
  id: string
  seq: number
  role: string
  content: string
}

/**
 * A Review Run's execution log — fetched on demand (never bundled into the
 * Issue's normal page data, see `listReviewRunLogs`) and, while the run is
 * still live, tailed over the same private `review-run:{id}` Broadcast
 * channel the host publishes to (`apps/gentic/src/review-run-realtime.ts`).
 * Deliberately its own hook rather than folded into `use-issue-chat-state.ts`,
 * so these logs can never leak into transcript state.
 */
export function useReviewRunLogs({
  issueId,
  reviewRunId,
  isLive,
  enabled,
}: {
  issueId: string
  reviewRunId: string
  isLive: boolean
  enabled: boolean
}) {
  const supabase = useSupabaseClient()
  const [logs, setLogs] = useState<ReviewRunLogEntry[]>([])
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle"
  )
  const seenSeqRef = useRef<Set<number>>(new Set())

  useEffect(() => {
    if (!enabled) {
      return
    }

    let cancelled = false

    async function load() {
      setStatus("loading")
      try {
        const formData = new FormData()
        formData.set("issue_id", issueId)
        formData.set("review_run_id", reviewRunId)
        const rows = await listReviewRunLogsAction(formData)
        if (cancelled) {
          return
        }
        seenSeqRef.current = new Set(rows.map((row) => row.seq))
        setLogs(rows)
        setStatus("ready")
      } catch {
        if (!cancelled) {
          setStatus("error")
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [enabled, issueId, reviewRunId])

  useEffect(() => {
    if (!enabled || !isLive) {
      return
    }

    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function join() {
      await supabase.realtime.setAuth()
      if (cancelled) {
        return
      }

      channel = supabase
        .channel(reviewRunRealtimeTopic(reviewRunId), {
          config: { private: true },
        })
        .on("broadcast", { event: REALTIME_MESSAGE_EVENT }, ({ payload }) => {
          const parsed = reviewRunLogEventSchema.safeParse(payload)
          if (!parsed.success || seenSeqRef.current.has(parsed.data.seq)) {
            return
          }
          seenSeqRef.current.add(parsed.data.seq)
          setLogs((current) =>
            [
              ...current,
              {
                id: `live-${parsed.data.seq}`,
                seq: parsed.data.seq,
                role: parsed.data.role,
                content: parsed.data.content,
              },
            ].toSorted((a, b) => a.seq - b.seq)
          )
        })
        .subscribe()
    }

    void join()

    return () => {
      cancelled = true
      if (channel) {
        void supabase.removeChannel(channel)
      }
    }
  }, [enabled, isLive, reviewRunId, supabase])

  return { logs, status }
}
