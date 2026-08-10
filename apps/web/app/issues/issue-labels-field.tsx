"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconCheck,
  IconChevronDown,
  IconPlus,
  IconSearch,
  IconTag,
  IconTagFilled,
} from "@tabler/icons-react"

import { createLabel } from "@/app/settings/actions"
import { fetchSettingsLabelsData } from "@/app/client-queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { Checkbox } from "@gentic/ui/checkbox"
import { Input } from "@gentic/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@gentic/ui/popover"
import { cn } from "@gentic/ui/utils"

export const MAX_ISSUE_LABELS = 20

export function IssueLabelsField({
  selectedIds,
  onSelectedIdsChange,
}: {
  selectedIds: string[]
  onSelectedIdsChange: (ids: string[]) => void
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = React.useState("")
  const labelsQuery = useQuery({
    queryKey: queryKeys.settingsLabels(""),
    queryFn: () => fetchSettingsLabelsData(),
    staleTime: queryStaleTimes.formOptions,
  })
  const labels = labelsQuery.data?.labels ?? []
  const selectedSet = new Set(selectedIds)
  const atLimit = selectedIds.length >= MAX_ISSUE_LABELS

  const trimmedSearch = search.trim()
  const normalizedSearch = trimmedSearch.toLocaleLowerCase()
  const filteredLabels = normalizedSearch
    ? labels.filter((label) =>
        label.name.toLocaleLowerCase().includes(normalizedSearch)
      )
    : labels
  const hasExactMatch = labels.some(
    (label) => label.name.toLocaleLowerCase() === normalizedSearch
  )

  const createMutation = useMutation({
    mutationFn: createLabel,
    onSuccess: async ({ label }) => {
      await queryClient.invalidateQueries({ queryKey: ["settings", "labels"] })
      onSelectedIdsChange([...selectedIds, label.id])
      setSearch("")
    },
  })

  function toggleLabel(id: string) {
    if (selectedSet.has(id)) {
      onSelectedIdsChange(selectedIds.filter((selectedId) => selectedId !== id))
      return
    }
    if (atLimit) {
      return
    }
    onSelectedIdsChange([...selectedIds, id])
  }

  function submitCreateLabel() {
    if (!trimmedSearch || atLimit || createMutation.isPending) {
      return
    }
    const formData = new FormData()
    formData.set("name", trimmedSearch)
    createMutation.mutate(formData)
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          <IconTag className="size-3.5" />
          <span>
            {selectedIds.length > 0
              ? `${selectedIds.length} label${selectedIds.length === 1 ? "" : "s"}`
              : "Labels"}
          </span>
          <IconChevronDown className="size-3.5 opacity-70" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
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
          <span className="shrink-0 text-xs text-muted-foreground">
            {selectedIds.length}/{MAX_ISSUE_LABELS}
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {labelsQuery.isLoading ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              Loading labels…
            </p>
          ) : null}
          {!labelsQuery.isLoading &&
          filteredLabels.length === 0 &&
          !trimmedSearch ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              No labels yet.
            </p>
          ) : null}
          {filteredLabels.map((label) => {
            const checked = selectedSet.has(label.id)
            const disabled = !checked && atLimit

            return (
              <label
                key={label.id}
                htmlFor={`issue-label-${label.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                  disabled ? "opacity-50" : "cursor-pointer hover:bg-muted"
                )}
              >
                <Checkbox
                  id={`issue-label-${label.id}`}
                  checked={checked}
                  disabled={disabled}
                  onCheckedChange={() => toggleLabel(label.id)}
                />
                <IconTagFilled
                  aria-hidden
                  className="size-3.5 shrink-0"
                  style={{ color: label.color }}
                />
                <span className="min-w-0 flex-1 truncate">{label.name}</span>
                {checked ? <IconCheck className="size-3.5 shrink-0" /> : null}
              </label>
            )
          })}
          {trimmedSearch && !hasExactMatch ? (
            <button
              type="button"
              disabled={atLimit || createMutation.isPending}
              onClick={submitCreateLabel}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
            >
              <IconPlus className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Create &ldquo;{trimmedSearch}&rdquo;
              </span>
            </button>
          ) : null}
        </div>
        {createMutation.isError ? (
          <p className="border-t border-foreground/10 px-3 py-2 text-xs text-destructive">
            {createMutation.error.message}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
