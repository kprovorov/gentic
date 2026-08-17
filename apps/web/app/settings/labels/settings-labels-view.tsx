"use client"

import Link from "next/link"
import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  IconArchive,
  IconArrowLeft,
  IconCheck,
  IconPalette,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react"
import { labelPresetColors } from "@gentic/validators/labels"

import { archiveLabel, createLabel, updateLabel } from "@/app/settings/actions"
import { fetchSettingsLabelsData } from "@/app/client-queries"
import type { SettingsLabelsData } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@gentic/ui/alert-dialog"
import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"
import { Input } from "@gentic/ui/input"
import { Label } from "@gentic/ui/label"
import { cn } from "@gentic/ui/utils"

const defaultCustomColor = "#2563EB"

export function SettingsLabelsView({
  initialData,
}: {
  initialData: SettingsLabelsData
}) {
  const queryClient = useQueryClient()
  const [search, setSearch] = React.useState("")
  const [createColor, setCreateColor] = React.useState<string>("")
  const [customColor, setCustomColor] = React.useState(defaultCustomColor)
  const labelsQuery = useQuery({
    queryKey: queryKeys.settingsLabels(search),
    queryFn: () => fetchSettingsLabelsData(search),
    initialData: search ? undefined : initialData,
    staleTime: queryStaleTimes.settings,
  })
  const invalidateLabels = async () => {
    await queryClient.invalidateQueries({ queryKey: ["settings", "labels"] })
  }
  const createMutation = useMutation({
    mutationFn: createLabel,
    onSuccess: invalidateLabels,
  })
  const updateMutation = useMutation({
    mutationFn: updateLabel,
    onSuccess: invalidateLabels,
  })
  const [archiveDialogLabelId, setArchiveDialogLabelId] = React.useState<
    string | null
  >(null)
  const archiveMutation = useMutation({
    mutationFn: archiveLabel,
    onSuccess: async () => {
      await invalidateLabels()
      setArchiveDialogLabelId(null)
    },
  })
  const labels = labelsQuery.data?.labels ?? []
  const selectedCreateColor = createColor || customColor
  const archiveDialogLabel =
    labels.find((label) => label.id === archiveDialogLabelId) ?? null

  function submitArchiveLabel() {
    if (!archiveDialogLabelId) return
    const formData = new FormData()
    formData.set("id", archiveDialogLabelId)
    archiveMutation.mutate(formData)
  }

  function submitCreateLabel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    if (createColor === "custom") {
      formData.set("color", customColor)
    } else if (createColor) {
      formData.set("color", createColor)
    } else {
      formData.delete("color")
    }

    createMutation.mutate(formData, {
      onSuccess: () => {
        form.reset()
        setCreateColor("")
        setCustomColor(defaultCustomColor)
      },
    })
  }

  function submitUpdateLabel(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateMutation.mutate(new FormData(event.currentTarget))
  }

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      {/* Catalog edits change `labels`; assignment counts change `issue_labels`
          (e.g. archiving elsewhere removes assignments). Refresh on both so the
          list, counts, and empty state stay current across tabs. */}
      <RealtimeRefresh
        channelName="settings-labels"
        tables={["labels", "issue_labels"]}
        queryKey={queryKeys.settingsLabelsRoot}
      />
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6">
          <Button asChild variant="ghost" size="sm" className="w-fit">
            <Link href="/settings">
              <IconArrowLeft />
              Settings
            </Link>
          </Button>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-muted-foreground">
              Settings
            </p>
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <h1 className="text-3xl">Labels</h1>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Manage the active label catalog for this account.
                </p>
              </div>
              <div className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
                {labels.length} active
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Add label</CardTitle>
              <CardDescription>
                Create up to 100 active labels per account.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submitCreateLabel} className="grid gap-5">
                <div className="grid gap-2">
                  <Label htmlFor="label-name">Name</Label>
                  <Input
                    id="label-name"
                    name="name"
                    placeholder="Customer reported"
                    maxLength={50}
                    required
                  />
                </div>
                <div className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <Label>Color</Label>
                    <button
                      type="button"
                      className={cn(
                        "inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-sm",
                        createColor === "" && "border-foreground"
                      )}
                      onClick={() => setCreateColor("")}
                    >
                      <IconPalette className="size-4" />
                      Auto
                    </button>
                  </div>
                  <div className="grid grid-cols-8 gap-2">
                    {labelPresetColors.map((color) => (
                      <ColorButton
                        key={color}
                        color={color}
                        selected={createColor === color}
                        label={`Use ${color}`}
                        onClick={() => setCreateColor(color)}
                      />
                    ))}
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="label-custom-color">Custom</Label>
                    <div className="flex gap-2">
                      <input
                        aria-label="Custom label color"
                        type="color"
                        value={customColor}
                        className="h-9 w-12 rounded-md border bg-background p-1"
                        onChange={(event) => {
                          setCustomColor(event.target.value.toUpperCase())
                          setCreateColor("custom")
                        }}
                      />
                      <Input
                        id="label-custom-color"
                        value={customColor}
                        pattern="#[0-9A-Fa-f]{6}"
                        maxLength={7}
                        onChange={(event) => {
                          setCustomColor(event.target.value.toUpperCase())
                          setCreateColor("custom")
                        }}
                      />
                    </div>
                  </div>
                  <input
                    type="hidden"
                    name="color"
                    value={createColor ? selectedCreateColor : ""}
                  />
                </div>
                {createMutation.isError ? (
                  <p className="text-sm text-destructive">
                    {createMutation.error.message}
                  </p>
                ) : null}
                <Button type="submit" disabled={createMutation.isPending}>
                  <IconPlus />
                  Add label
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-4">
            <div className="relative">
              <IconSearch className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                placeholder="Search labels"
                className="pl-9"
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            {labelsQuery.isError ? (
              <div className="rounded-md border border-destructive/30 p-4 text-sm text-destructive">
                Unable to load labels.
              </div>
            ) : labels.length === 0 ? (
              <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No active labels found.
              </div>
            ) : (
              <div className="grid gap-3">
                {labels.map((label) => (
                  <Card key={label.id}>
                    <CardContent className="p-4">
                      <form
                        onSubmit={submitUpdateLabel}
                        className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto_auto_auto] md:items-end"
                      >
                        <input type="hidden" name="id" value={label.id} />
                        <div className="grid gap-2">
                          <Label htmlFor={`label-name-${label.id}`}>Name</Label>
                          <Input
                            id={`label-name-${label.id}`}
                            name="name"
                            defaultValue={label.name}
                            required
                            maxLength={50}
                          />
                        </div>
                        <div className="grid gap-2">
                          <Label htmlFor={`label-color-${label.id}`}>
                            Color
                          </Label>
                          <div className="flex gap-2">
                            <span
                              aria-hidden
                              className="size-9 rounded-md border"
                              style={{ backgroundColor: label.color }}
                            />
                            <Input
                              id={`label-color-${label.id}`}
                              name="color"
                              defaultValue={label.color}
                              pattern="#[0-9A-Fa-f]{6}"
                              maxLength={7}
                              className="font-mono"
                            />
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <div className="font-medium text-foreground">
                            {label.assignment_count}
                          </div>
                          <div>assigned</div>
                        </div>
                        <Button
                          type="submit"
                          variant="outline"
                          disabled={updateMutation.isPending}
                        >
                          <IconCheck />
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setArchiveDialogLabelId(label.id)}
                        >
                          <IconArchive />
                          Archive
                        </Button>
                      </form>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <AlertDialog
        open={archiveDialogLabel !== null}
        onOpenChange={(open) => {
          if (!open) {
            setArchiveDialogLabelId(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Archive {archiveDialogLabel?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {archiveAssignmentSummary(archiveDialogLabel?.assignment_count)}{" "}
              It will disappear from Settings, assignment autocomplete, and
              filters. Past activity that referenced it stays visible in issue
              timelines. Those assignments won&rsquo;t come back, but creating a
              label with the same name later restores it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {archiveMutation.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {archiveMutation.error.message}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={archiveMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={archiveMutation.isPending}
              onClick={(event) => {
                event.preventDefault()
                submitArchiveLabel()
              }}
            >
              {archiveMutation.isPending ? "Archiving..." : "Archive label"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function archiveAssignmentSummary(assignmentCount: number | undefined) {
  const count = assignmentCount ?? 0
  if (count === 0) {
    return "This label isn't assigned to any issues."
  }
  return `This removes it from ${count} assigned issue${count === 1 ? "" : "s"}.`
}

function ColorButton({
  color,
  selected,
  label,
  onClick,
}: {
  color: string
  selected: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      className={cn(
        "flex size-8 items-center justify-center rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        selected ? "border-foreground" : "border-border"
      )}
      style={{ backgroundColor: color }}
      onClick={onClick}
    >
      {selected ? (
        <IconCheck className="size-4 text-white drop-shadow" />
      ) : null}
    </button>
  )
}
