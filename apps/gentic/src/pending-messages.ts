import type { AgentApi, UserMessage } from "./api.js"
import type { PromptDelivery, PromptTurn } from "./session.js"

type QueuedMessage = {
  id: string
  content: string
  created_at: string
  seq: number
}

export interface PendingMessagePromptSource {
  wake(): void
  nextPrompt(): Promise<PromptDelivery | null>
  onPromptProcessed(messageIds: string[]): Promise<void>
}

export function createPendingMessagePromptSource(input: {
  api: Pick<AgentApi, "fetchPendingUserMessages" | "ackUserMessages">
  issueId: string
  runId: string
  pollIntervalMs: number
  buildPrompt: (message: QueuedMessage) => Promise<PromptTurn>
  onFetchError?: (error: unknown) => void
}): PendingMessagePromptSource {
  const queuedMessageIds = new Set<string>()
  const inFlightMessageIds = new Set<string>()
  const queue: QueuedMessage[] = []
  let queueWaiter: (() => void) | null = null
  let idleChecked = false

  const enqueue = (message: UserMessage): void => {
    if (queuedMessageIds.has(message.id) || inFlightMessageIds.has(message.id)) {
      return
    }
    queuedMessageIds.add(message.id)
    const entry: QueuedMessage = {
      id: message.id,
      content: message.content ?? "",
      created_at: message.created_at,
      seq: message.seq,
    }
    const index = queue.findIndex((existing) => existing.seq > entry.seq)
    if (index === -1) {
      queue.push(entry)
    } else {
      queue.splice(index, 0, entry)
    }
    wake()
  }

  async function fetchAndEnqueuePending(): Promise<void> {
    const pending = await input.api.fetchPendingUserMessages(input.issueId)
    for (const message of pending) {
      enqueue(message)
    }
  }

  function wake(): void {
    if (queueWaiter) {
      const resolve = queueWaiter
      queueWaiter = null
      resolve()
    }
  }

  const waitForQueueOrTimeout = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        queueWaiter = null
        resolve()
      }, ms)
      queueWaiter = () => {
        clearTimeout(timer)
        resolve()
      }
    })

  return {
    wake() {
      void fetchAndEnqueuePending()
        .catch((error) => input.onFetchError?.(error))
        .finally(wake)
    },
    async nextPrompt() {
      for (;;) {
        await fetchAndEnqueuePending()
        const next = queue.shift()
        if (next) {
          queuedMessageIds.delete(next.id)
          inFlightMessageIds.add(next.id)
          idleChecked = false
          return {
            prompt: await input.buildPrompt(next),
            messageIds: [next.id],
          }
        }
        if (idleChecked) {
          return null
        }
        idleChecked = true
        await waitForQueueOrTimeout(input.pollIntervalMs)
      }
    },
    async onPromptProcessed(messageIds) {
      await input.api.ackUserMessages(input.issueId, input.runId, messageIds)
      for (const id of messageIds) {
        inFlightMessageIds.delete(id)
      }
    },
  }
}
