"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { IssuesView } from "@/app/issues/issues-view"
import { IssueDetailHeader } from "@/app/issues/[code]/issue-detail-header"
import { IssueDetailRail } from "@/app/issues/[code]/issue-detail-rail"
import { IssueTimeline } from "@/app/issues/[code]/issue-timeline/issue-timeline"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { NewIssueDialogProvider } from "@/components/new-issue-dialog-provider"
import { NewIssueDialog } from "@/components/new-issue-dialog"
import { SidebarProvider, SidebarInset } from "@gentic/ui/sidebar"
import { ThemeProvider } from "@gentic/ui/theme-provider"
import { TooltipProvider } from "@gentic/ui/tooltip"
import { queryKeys } from "@/app/query-keys"
import {
  issuesData,
  planningData,
  project,
  labels,
  reviewIssue,
  pullRequests,
  reviewCycles,
  timeline,
} from "./fixtures"

export default function CaptureView() {
  const scene = useSearchParams().get("scene")
  const [client] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { enabled: false, retry: false, staleTime: Infinity },
      },
    })
    client.setQueryData(queryKeys.settingsLabels(), {
      labels: labels.map((label) => ({ ...label, state: "active" })),
    })
    client.setQueryData(queryKeys.newIssue, {
      projects: [project],
      defaultAgentProvider: "claude_code",
    })
    client.setQueryData(
      queryKeys.issues,
      scene === "planning" ? planningData : issuesData
    )
    return client
  })
  const common = {
    pullRequests,
    automaticPrPublishingInProgress: false,
    relations: [],
    relationCandidates: [],
    labels: reviewIssue.labels,
    attachments: [],
    messageAttachments: [],
    reviewCycles,
    implementationOwner: null,
  }
  return (
    <ThemeProvider defaultTheme="light" forcedTheme="light">
      <TooltipProvider>
        <QueryClientProvider client={client}>
          <NewIssueDialogProvider>
            <SidebarProvider>
              <AppSidebar variant="inset" />
              <SidebarInset>
                <SiteHeader />
                {scene === "review" ? (
                  <div className="flex h-[calc(100dvh-3.5rem)] min-w-0 flex-col overflow-hidden bg-background">
                    <IssueDetailHeader issue={reviewIssue} {...common} />
                    <div className="flex min-h-0 min-w-0 flex-1 border-t">
                      <div className="min-w-0 flex-1 overflow-y-auto px-6 pt-5 pb-6">
                        <div className="mx-auto w-full max-w-[840px]">
                          <IssueTimeline
                            items={timeline}
                            currentUserName="Alex"
                          />
                        </div>
                      </div>
                      <aside className="w-[19rem] shrink-0 overflow-y-auto border-l bg-muted/25">
                        <IssueDetailRail
                          {...common}
                          issueId={reviewIssue.id}
                          issueCode={reviewIssue.code}
                          status={reviewIssue.status}
                          priority={reviewIssue.priority}
                          isSpec={false}
                          hasUnpublishedAgentChanges={false}
                        />
                      </aside>
                    </div>
                  </div>
                ) : (
                  <IssuesView
                    initialData={
                      scene === "planning" ? planningData : issuesData
                    }
                  />
                )}
              </SidebarInset>
            </SidebarProvider>
            <NewIssueDialog />
          </NewIssueDialogProvider>
        </QueryClientProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}
