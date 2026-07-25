import { Skeleton } from "@gentic/ui"

export function IssueRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        maxWidth: 360,
      }}
    >
      <Skeleton style={{ height: 16, width: 16, borderRadius: 4 }} />
      <div style={{ display: "grid", gap: 6, flex: 1 }}>
        <Skeleton style={{ height: 12, width: "70%" }} />
        <Skeleton style={{ height: 10, width: "40%" }} />
      </div>
      <Skeleton style={{ height: 20, width: 60, borderRadius: 999 }} />
    </div>
  )
}

export function CardLoading() {
  return (
    <div
      style={{
        display: "grid",
        gap: 10,
        maxWidth: 320,
        padding: 16,
        borderRadius: 16,
        border: "1px solid var(--border)",
      }}
    >
      <Skeleton style={{ height: 14, width: "60%" }} />
      <Skeleton style={{ height: 10, width: "40%" }} />
      <Skeleton style={{ height: 60, width: "100%", marginTop: 4 }} />
      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <Skeleton style={{ height: 28, width: 96, borderRadius: 999 }} />
        <Skeleton style={{ height: 28, width: 80, borderRadius: 999 }} />
      </div>
    </div>
  )
}
