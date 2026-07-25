import { Input } from "@gentic/ui"

export function Placeholder() {
  return (
    <Input placeholder="Search issues…" style={{ maxWidth: 280 }} />
  )
}

export function Filled() {
  return (
    <Input defaultValue="kprovorov/gentic" style={{ maxWidth: 280 }} />
  )
}

export function Disabled() {
  return (
    <Input
      disabled
      defaultValue="Fix login redirect bug"
      style={{ maxWidth: 280 }}
    />
  )
}

export function Invalid() {
  return (
    <Input
      aria-invalid
      defaultValue="not-a-repo"
      style={{ maxWidth: 280 }}
    />
  )
}
