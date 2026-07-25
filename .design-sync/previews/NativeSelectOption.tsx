import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@gentic/ui"

export function ProjectPicker() {
  return (
    <NativeSelect defaultValue="" style={{ width: 260 }}>
      <NativeSelectOption value="" disabled hidden>
        Select a project
      </NativeSelectOption>
      <NativeSelectOption value="web">gentic/web</NativeSelectOption>
      <NativeSelectOption value="gentic">gentic/gentic</NativeSelectOption>
      <NativeSelectOption value="ui">gentic/ui</NativeSelectOption>
    </NativeSelect>
  )
}

export function IssueStatus() {
  return (
    <NativeSelect defaultValue="in-progress" style={{ width: 220 }}>
      <NativeSelectOption value="todo">To do</NativeSelectOption>
      <NativeSelectOption value="in-progress">
        In progress
      </NativeSelectOption>
      <NativeSelectOption value="ready-for-review">
        Ready for review
      </NativeSelectOption>
      <NativeSelectOption value="merged">Merged</NativeSelectOption>
      <NativeSelectOption value="cancelled">Cancelled</NativeSelectOption>
    </NativeSelect>
  )
}

export function Small() {
  return (
    <NativeSelect size="sm" defaultValue="claude_code" style={{ width: 180 }}>
      <NativeSelectOption value="claude_code">Claude Code</NativeSelectOption>
      <NativeSelectOption value="codex">Codex</NativeSelectOption>
    </NativeSelect>
  )
}

export function Disabled() {
  return (
    <NativeSelect disabled defaultValue="claude_code" style={{ width: 220 }}>
      <NativeSelectOption value="claude_code">Claude Code</NativeSelectOption>
      <NativeSelectOption value="codex">Codex</NativeSelectOption>
    </NativeSelect>
  )
}

export function Grouped() {
  return (
    <NativeSelect defaultValue="web" style={{ width: 260 }}>
      <NativeSelectOptGroup label="Active projects">
        <NativeSelectOption value="web">gentic/web</NativeSelectOption>
        <NativeSelectOption value="gentic">gentic/gentic</NativeSelectOption>
        <NativeSelectOption value="ui">gentic/ui</NativeSelectOption>
      </NativeSelectOptGroup>
      <NativeSelectOptGroup label="Archived">
        <NativeSelectOption value="legacy-api">
          gentic/legacy-api
        </NativeSelectOption>
      </NativeSelectOptGroup>
    </NativeSelect>
  )
}
