import { Checkbox } from "@gentic/ui"

export function IssueSelectionList() {
  const issues = [
    { id: "GEN-142", title: "Fix login redirect bug", checked: true },
    { id: "GEN-138", title: "Add rate limiting to API", checked: true },
    { id: "GEN-129", title: "Table view sort by priority", checked: false },
  ]

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {issues.map((issue) => (
        <label
          key={issue.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 14,
          }}
        >
          <Checkbox defaultChecked={issue.checked} />
          <span
            className="text-muted-foreground"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {issue.id}
          </span>
          <span>{issue.title}</span>
        </label>
      ))}
    </div>
  )
}

export function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label
        style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}
      >
        <Checkbox />
        <span>Unchecked</span>
      </label>
      <label
        style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}
      >
        <Checkbox defaultChecked />
        <span>Checked</span>
      </label>
      <label
        style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14 }}
      >
        <Checkbox checked="indeterminate" />
        <span>Indeterminate — select all</span>
      </label>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 14,
          opacity: 0.6,
        }}
      >
        <Checkbox disabled />
        <span>Disabled</span>
      </label>
    </div>
  )
}
