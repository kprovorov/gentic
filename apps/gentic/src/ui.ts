/**
 * Shared CLI UI primitives. Import prompts from this module instead of
 * `@clack/prompts` directly so commands keep a consistent look.
 *
 * Convention: any command that allows a prompt to be cancelled must check
 * `isCancel(result)` and exit cleanly with `cancel("Cancelled.")`. Clack
 * returns a cancellation symbol instead of throwing, so missing this check can
 * accidentally treat Ctrl+C as normal input.
 */
export {
  intro,
  outro,
  spinner,
  log,
  note,
  cancel,
  isCancel,
  text,
  password,
  confirm,
  select,
} from "@clack/prompts"
