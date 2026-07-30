"use client"

import { useId, useState } from "react"
import { IconInfoCircle } from "@tabler/icons-react"

import { Checkbox } from "@gentic/ui/checkbox"
import { Label } from "@gentic/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@gentic/ui/tooltip"
import { cn } from "@gentic/ui/utils"

export const automaticPrPreferenceTooltipCopy =
  "When the agent finishes with code changes, Gentic sends a follow-up asking it to create a branch, commit and push the changes, and open a ready-for-review pull request. This uses an additional agent turn."

export function AutomaticPrPreferenceField({
  defaultChecked,
  disabled = false,
  className,
  onCheckedChange,
}: {
  // This is read only on mount. Callers showing refreshed persisted data should
  // change this component's key when the default value changes.
  defaultChecked: boolean
  disabled?: boolean
  className?: string
  onCheckedChange?: (checked: boolean) => void
}) {
  const [checked, setChecked] = useState(defaultChecked)
  const fieldId = useId()
  const tooltipId = useId()
  const historicalNoteId = useId()

  return (
    <div className={cn("flex min-w-0 items-start gap-2.5", className)}>
      {!disabled ? (
        <input
          type="hidden"
          name="create_pr_automatically"
          value={checked ? "true" : "false"}
        />
      ) : null}
      <Checkbox
        id={fieldId}
        checked={checked}
        disabled={disabled}
        aria-describedby={disabled ? historicalNoteId : undefined}
        onCheckedChange={(value) => {
          const nextChecked = value === true
          setChecked(nextChecked)
          onCheckedChange?.(nextChecked)
        }}
        className="mt-0.5"
      />
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <Label htmlFor={fieldId} className="min-w-0 font-normal">
            Create PR automatically
          </Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="About Create PR automatically"
                aria-describedby={tooltipId}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <IconInfoCircle className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              id={tooltipId}
              side="top"
              className="max-w-80 leading-relaxed whitespace-normal"
            >
              {automaticPrPreferenceTooltipCopy}
            </TooltipContent>
          </Tooltip>
        </div>
        {disabled ? (
          <p id={historicalNoteId} className="text-xs text-muted-foreground">
            A pull request is already attached, so this setting is historical.
          </p>
        ) : null}
      </div>
    </div>
  )
}
