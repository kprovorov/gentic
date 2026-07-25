import { Separator } from "@gentic/ui"

export function Horizontal() {
  return (
    <div style={{ maxWidth: 320 }}>
      <p style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>
        Fix login redirect bug
      </p>
      <Separator style={{ margin: "12px 0" }} />
      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: "var(--muted-foreground)",
        }}
      >
        Users are redirected to the wrong page after signing in with an
        expired session.
      </p>
    </div>
  )
}

export function Vertical() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 20,
        fontSize: 14,
        color: "var(--muted-foreground)",
      }}
    >
      <span>gentic/web</span>
      <Separator orientation="vertical" />
      <span>#482</span>
      <Separator orientation="vertical" />
      <span>opened 2 days ago</span>
    </div>
  )
}
