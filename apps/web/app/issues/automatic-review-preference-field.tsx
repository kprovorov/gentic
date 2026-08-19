"use client"

import { useId, useState } from "react"

import type { AgentProvider } from "@gentic/validators/issues"
import { Label } from "@gentic/ui/label"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"
import { cn } from "@gentic/ui/utils"

import { agentProviderLabels } from "./agent-provider-options"
import type {
  IssueReviewPolicySnapshot,
  ProjectAutomaticReviewDefaults,
} from "@/app/query-contracts"

type OverrideValue = "" | "true" | "false"

function toOverrideValue(value: boolean | null): OverrideValue {
  if (value === null) return ""
  return value ? "true" : "false"
}

/**
 * The Issue-level Automatic Review override. Null inherits the Project
 * default. Editable before the first pull request is associated; once a
 * policy is snapshotted, the override is historical and this shows the
 * frozen snapshot instead of a control.
 */
export function AutomaticReviewPreferenceField({
  defaultValue,
  disabled = false,
  projectDefault,
  policy,
  effectiveAgentProvider,
  effectiveIssueModel,
  className,
}: {
  // Read only on mount, like AutomaticPrPreferenceField — change this
  // component's key when the caller shows refreshed persisted data.
  defaultValue: boolean | null
  disabled?: boolean
  projectDefault: ProjectAutomaticReviewDefaults | null
  policy: IssueReviewPolicySnapshot | null
  effectiveAgentProvider: AgentProvider
  effectiveIssueModel: string | null
  className?: string
}) {
  const [value, setValue] = useState<OverrideValue>(
    toOverrideValue(defaultValue)
  )
  const fieldId = useId()
  const noteId = useId()

  const projectEnabled = projectDefault?.enabled ?? false
  const effectiveEnabled = value === "" ? projectEnabled : value === "true"
  const effectiveProvider = projectDefault?.provider ?? effectiveAgentProvider
  const effectiveModel = projectDefault?.model ?? effectiveIssueModel

  return (
    <div className={cn("grid gap-2", className)}>
      {!disabled ? (
        <input type="hidden" name="automatic_review_enabled" value={value} />
      ) : null}
      <Label htmlFor={fieldId}>Automatic Code Review</Label>
      {disabled ? (
        <div
          id={noteId}
          className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground"
        >
          {policy ? (
            <>
              <p>
                Snapshotted when the first pull request was associated:{" "}
                <span className="font-medium text-foreground">
                  {policy.enabled ? "Enabled" : "Disabled"}
                </span>{" "}
                using {agentProviderLabels[policy.reviewer_provider]}
                {policy.reviewer_model ? ` (${policy.reviewer_model})` : ""}.
              </p>
              {policy.reviewer_instructions ? (
                <p className="mt-1">
                  Additional instructions: {policy.reviewer_instructions}
                </p>
              ) : null}
            </>
          ) : (
            <p>
              A pull request is already attached, so this setting is historical.
            </p>
          )}
        </div>
      ) : (
        <>
          <NativeSelect
            id={fieldId}
            aria-describedby={noteId}
            value={value}
            className="w-full"
            onChange={(event) => setValue(event.target.value as OverrideValue)}
          >
            <NativeSelectOption value="">
              Use Project default ({projectEnabled ? "Enabled" : "Disabled"})
            </NativeSelectOption>
            <NativeSelectOption value="true">Enabled</NativeSelectOption>
            <NativeSelectOption value="false">Disabled</NativeSelectOption>
          </NativeSelect>
          <p id={noteId} className="text-xs text-muted-foreground">
            Effective now: {effectiveEnabled ? "Enabled" : "Disabled"} using{" "}
            {agentProviderLabels[effectiveProvider]}
            {effectiveModel ? ` (${effectiveModel})` : ""}. This is snapshotted
            permanently the moment the first pull request is associated with
            this issue.
          </p>
        </>
      )}
    </div>
  )
}
