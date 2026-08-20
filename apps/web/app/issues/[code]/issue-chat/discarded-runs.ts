/**
 * Resetting an issue wipes its transcript in the database, but nothing stops
 * the worker process that owned the run: it keeps publishing `message`
 * broadcasts on the issue's realtime channel until it happens to attempt a
 * write and gets a 409 back. Those broadcasts never become rows — the agent API
 * refuses them once the run is no longer active — yet the browser applies every
 * broadcast it receives, so they repopulate the transcript the reset just
 * cleared. Nothing removes them afterwards either: hydration and reconnect
 * reconciliation merge the server snapshot in rather than replacing it, on
 * purpose, so an in-flight message is never yanked out from under the user.
 *
 * The result is a transcript full of messages from a conversation that no
 * longer exists, surviving until a full page reload. So the reset reports which
 * runs it discarded and the transcript refuses their events at the door.
 */
export function rememberDiscardedRuns(
  current: ReadonlySet<string>,
  runIds: readonly string[]
): Set<string> {
  return new Set([...current, ...runIds])
}

/**
 * Whether a broadcast belongs to a run a reset already threw away. Events
 * without a `run_id` are always kept: the tag is optional in the wire contract,
 * and dropping untagged events would silence legitimate ones.
 */
export function isDiscardedRunEvent(
  discardedRunIds: ReadonlySet<string>,
  event: { run_id?: string | null }
): boolean {
  return event.run_id != null && discardedRunIds.has(event.run_id)
}
