import { Label, Input, Checkbox } from "@gentic/ui"

export function WithInput() {
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 280 }}>
      <Label htmlFor="project-repo">Repo</Label>
      <Input id="project-repo" placeholder="kprovorov/gentic" />
    </div>
  )
}

export function WithCheckbox() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Checkbox id="project-auto-respond" defaultChecked />
      <Label htmlFor="project-auto-respond" style={{ fontWeight: 400 }}>
        Auto-respond to review feedback
      </Label>
    </div>
  )
}

export function Disabled() {
  return (
    <div
      data-disabled="true"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        opacity: 0.5,
      }}
    >
      <Checkbox id="project-archived" disabled />
      <Label htmlFor="project-archived">Archived</Label>
    </div>
  )
}
