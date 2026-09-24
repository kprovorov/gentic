"use client"

import { useQuery } from "@tanstack/react-query"
import { IconCheck, IconChevronDown, IconServer } from "@tabler/icons-react"

import { fetchSettingsHostsData } from "@/app/client-queries"
import type { SettingsHost } from "@/app/queries"
import { queryKeys, queryStaleTimes } from "@/app/query-keys"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@gentic/ui/dropdown-menu"
import { cn } from "@gentic/ui/utils"

export const ANY_HOST_LABEL = "Any host"

const hostStateLabels: Record<SettingsHost["primaryState"], string> = {
  online: "Online",
  offline: "Offline",
  banned: "Banned",
  "setup-incomplete": "Setup incomplete",
}

// Hosts a new pin may target. A banned host never claims work, so offering it
// would only produce an issue that waits forever; it is left out entirely
// rather than shown disabled. Online hosts come first because they are the
// ones that will actually pick the issue up now.
export function listPinnableHosts(hosts: SettingsHost[]): SettingsHost[] {
  return hosts
    .filter((host) => host.primaryState !== "banned")
    .toSorted((left, right) => {
      const leftOnline = left.primaryState === "online" ? 0 : 1
      const rightOnline = right.primaryState === "online" ? 0 : 1
      if (leftOnline !== rightOnline) {
        return leftOnline - rightOnline
      }
      return left.editableName.localeCompare(right.editableName, undefined, {
        sensitivity: "base",
      })
    })
}

export function hostStateLabel(state: SettingsHost["primaryState"]): string {
  return hostStateLabels[state]
}

// Shares the Settings page's hosts query, so the picker reads whatever that
// page has already cached and the two never disagree about a host's state.
export function useHostOptions() {
  const query = useQuery({
    queryKey: queryKeys.settingsHosts,
    queryFn: fetchSettingsHostsData,
    staleTime: queryStaleTimes.formOptions,
  })

  return {
    hosts: query.data?.hosts ?? [],
    isLoading: query.isLoading,
  }
}

// Pill picker for the issue composer's meta row: pins the issue to one host,
// or leaves it on the shared queue. Renders nothing until at least one host
// is enrolled, since with no hosts there is nothing to choose between.
export function IssueHostPicker({
  pinnedHostId,
  onPinnedHostChange,
  className,
}: {
  pinnedHostId: string | null
  onPinnedHostChange: (hostId: string | null) => void
  className?: string
}) {
  const { hosts } = useHostOptions()
  const options = listPinnableHosts(hosts)
  const selected = hosts.find((host) => host.id === pinnedHostId) ?? null

  if (hosts.length === 0) {
    return null
  }

  return (
    // Non-modal for the same reason as the agent picker: this can sit inside
    // the New Issue dialog, and a modal menu would close the dialog on the
    // click meant to close the menu.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label="Choose host" className={className}>
          <IconServer className="size-3.5 shrink-0" />
          <span className="max-w-40 truncate">
            {selected ? selected.editableName : ANY_HOST_LABEL}
          </span>
          <IconChevronDown className="size-3.5 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuItem onSelect={() => onPinnedHostChange(null)}>
          <span className="min-w-0 flex-1">
            <span className="block truncate">{ANY_HOST_LABEL}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              First available host claims it
            </span>
          </span>
          {pinnedHostId === null ? (
            <IconCheck className="ml-auto size-3.5" />
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map((host) => (
          <DropdownMenuItem
            key={host.id}
            onSelect={() => onPinnedHostChange(host.id)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">{host.editableName}</span>
              <span
                className={cn(
                  "block truncate text-xs font-normal",
                  host.primaryState === "online"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground"
                )}
              >
                {hostStateLabel(host.primaryState)}
              </span>
            </span>
            {host.id === pinnedHostId ? (
              <IconCheck className="ml-auto size-3.5" />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
