import { Textarea } from "@gentic/ui"

export function Placeholder() {
  return (
    <Textarea
      placeholder="Add context, acceptance notes, or links."
      rows={4}
      style={{ maxWidth: 320 }}
    />
  )
}

export function Filled() {
  return (
    <Textarea
      defaultValue={"npm install\nnpm run build"}
      rows={4}
      className="font-mono"
      style={{ maxWidth: 320 }}
    />
  )
}

export function Disabled() {
  return (
    <Textarea
      disabled
      defaultValue="Users are redirected to the wrong page after signing in with an expired session."
      rows={4}
      style={{ maxWidth: 320 }}
    />
  )
}
