"use client"

import * as React from "react"
import { IconCheck, IconChevronDown, IconSearch } from "@tabler/icons-react"

import type { AssignedIssueLabel } from "@/app/query-contracts"
import { Button } from "@gentic/ui/button"
import { Checkbox } from "@gentic/ui/checkbox"
import { Input } from "@gentic/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@gentic/ui/popover"

// Shared "Add labels" / "Remove labels" bulk-toolbar control: searches and
// multi-selects from the account's active Labels (already alphabetically
// sorted by the caller), then applies the whole selection in one shot via
// `onApply` rather than mutating per checkbox click — bulk label changes are
// a single atomic operation, not N individual assignments.
export function BulkLabelPicker({
  idPrefix,
  triggerLabel,
  emptyLabel,
  applyLabel,
  labels,
  disabled,
  pending,
  onApply,
}: {
  idPrefix: string
  triggerLabel: string
  emptyLabel: string
  applyLabel: (count: number) => string
  labels: AssignedIssueLabel[]
  disabled?: boolean
  pending?: boolean
  onApply: (labelIds: string[]) => void
}) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  const [selectedIds, setSelectedIds] = React.useState<string[]>([])

  const normalizedSearch = search.trim().toLocaleLowerCase()
  const filteredLabels = normalizedSearch
    ? labels.filter((option) =>
        option.name.toLocaleLowerCase().includes(normalizedSearch)
      )
    : labels
  const selectedSet = new Set(selectedIds)

  function reset() {
    setSearch("")
    setSelectedIds([])
  }

  function toggle(id: string) {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((existing) => existing !== id)
        : [...current, id]
    )
  }

  function apply() {
    if (selectedIds.length === 0 || pending) {
      return
    }
    onApply(selectedIds)
    setOpen(false)
    reset()
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          reset()
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled || pending}>
          {triggerLabel}
          <IconChevronDown className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <div className="flex items-center gap-2 border-b border-foreground/10 px-3 py-2">
          <div className="relative flex-1">
            <IconSearch className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search labels"
              className="h-8 pl-7 text-sm"
              autoFocus
            />
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {filteredLabels.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {emptyLabel}
            </p>
          ) : null}
          {filteredLabels.map((option) => {
            const checked = selectedSet.has(option.id)
            const inputId = `${idPrefix}-bulk-label-${option.id}`

            return (
              <label
                key={option.id}
                htmlFor={inputId}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
              >
                <Checkbox
                  id={inputId}
                  checked={checked}
                  onCheckedChange={() => toggle(option.id)}
                />
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: option.color }}
                />
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
                {checked ? <IconCheck className="size-3.5 shrink-0" /> : null}
              </label>
            )
          })}
        </div>
        <div className="border-t border-foreground/10 p-2">
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={selectedIds.length === 0 || pending}
            onClick={apply}
          >
            {applyLabel(selectedIds.length)}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
