"use client"

import { useId, useState } from "react"

import {
  agentModelOptions,
  type AgentProvider,
} from "@gentic/validators/issues"
import { Checkbox } from "@gentic/ui/checkbox"
import { Label } from "@gentic/ui/label"
import { NativeSelect, NativeSelectOption } from "@gentic/ui/native-select"
import { Textarea } from "@gentic/ui/textarea"

/**
 * Project-level Automatic Review defaults, reused by the create-project and
 * per-project edit forms. Provider/model default to "Same as Issue" (an
 * empty select value maps to `null`), so a fresh project never inherits a
 * stale provider/model pairing into editable state.
 */
export function AutomaticReviewFields({
  defaultEnabled = false,
  defaultProvider = null,
  defaultModel = null,
  defaultInstructions = null,
}: {
  defaultEnabled?: boolean
  defaultProvider?: AgentProvider | null
  defaultModel?: string | null
  defaultInstructions?: string | null
}) {
  const [enabled, setEnabled] = useState(defaultEnabled)
  const [provider, setProvider] = useState<AgentProvider | "">(
    defaultProvider ?? ""
  )
  const [model, setModel] = useState(defaultModel ?? "")
  const enabledId = useId()
  const providerId = useId()
  const modelId = useId()
  const instructionsId = useId()

  return (
    <div className="grid gap-3 rounded-md border p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={enabledId}
          name="automatic_review_enabled"
          checked={enabled}
          onCheckedChange={(value) => setEnabled(value === true)}
        />
        <Label htmlFor={enabledId} className="font-normal">
          Enable Automatic Code Review
        </Label>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor={providerId}>Reviewer</Label>
          <NativeSelect
            id={providerId}
            name="automatic_review_provider"
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value as AgentProvider | "")
              setModel("")
            }}
          >
            <NativeSelectOption value="">Same as Issue</NativeSelectOption>
            <NativeSelectOption value="claude_code">
              Claude Code
            </NativeSelectOption>
            <NativeSelectOption value="codex">Codex</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={modelId}>Model</Label>
          <NativeSelect
            id={modelId}
            name="automatic_review_model"
            value={model}
            disabled={provider === ""}
            onChange={(event) => setModel(event.target.value)}
          >
            <NativeSelectOption value="">Same as Issue</NativeSelectOption>
            {provider
              ? agentModelOptions[provider].map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))
              : null}
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-2">
        <Label htmlFor={instructionsId}>
          Additional reviewer instructions (optional)
        </Label>
        <Textarea
          id={instructionsId}
          name="automatic_review_instructions"
          defaultValue={defaultInstructions ?? ""}
          placeholder="Focus on security and test coverage."
          rows={3}
          className="font-mono"
        />
        <p className="text-xs text-muted-foreground">
          Added on top of the repository&apos;s own review instructions, not a
          replacement for them.
        </p>
      </div>
    </div>
  )
}
