import { Toggle } from "@gentic/ui"

export function States() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Toggle aria-label="Bold">B</Toggle>
      <Toggle aria-label="Italic" pressed>
        I
      </Toggle>
      <Toggle aria-label="Disabled" disabled>
        D
      </Toggle>
    </div>
  )
}

export function Variants() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Toggle variant="default">Default</Toggle>
      <Toggle variant="outline">Outline</Toggle>
    </div>
  )
}

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Toggle size="sm">Small</Toggle>
      <Toggle size="default">Default</Toggle>
      <Toggle size="lg">Large</Toggle>
    </div>
  )
}
