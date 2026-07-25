import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@gentic/ui"

export function ToolCallGroup() {
  return (
    <Collapsible open className="w-[360px] overflow-hidden rounded-xl border bg-muted">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2 text-left text-xs text-muted-foreground"
        >
          <span>✓</span>
          <span className="flex-1 font-medium">3 tool calls</span>
          <span>▾</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-1.5 border-t px-3.5 py-2">
          <pre className="rounded bg-background/60 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
            grep -rn &quot;AlertDialog&quot; apps/web
          </pre>
          <pre className="rounded bg-background/60 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
            Read apps/web/app/issues/bulk-actions-toolbar.tsx
          </pre>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function ExpandedSection() {
  return (
    <Collapsible open className="w-[320px] rounded-xl border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 px-3.5 py-2.5 text-left text-sm font-medium"
        >
          <span className="flex-1">Advanced settings</span>
          <span className="text-muted-foreground">▾</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t px-3.5 py-2.5 text-sm text-muted-foreground">
          Expanded state — toggling the trigger reveals or hides this
          content.
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
