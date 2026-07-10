"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { IconListDetails, IconPlus } from "@tabler/icons-react"

import { getHomeData, type HomeData } from "@/app/queries"
import { queryKeys } from "@/app/query-keys"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { Button } from "@gentic/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@gentic/ui/card"

export function HomeView({ initialData }: { initialData: HomeData }) {
  const { data } = useQuery({
    queryKey: queryKeys.home,
    queryFn: getHomeData,
    initialData,
  })
  const activeIssueCount = data.issues.filter(
    (issue) =>
      issue.status !== "completed" &&
      issue.status !== "cancelled" &&
      issue.status !== "merged"
  ).length

  return (
    <div className="bg-background px-4 py-8 md:px-8">
      <RealtimeRefresh
        channelName="home-widgets"
        tables={["issues", "issue_relations"]}
        queryKey={queryKeys.home}
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b pb-6 md:flex-row md:items-end md:justify-between">
          <div className="grid gap-2">
            <p className="text-sm font-medium text-muted-foreground">Home</p>
            <h1 className="text-3xl">Overview</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/issues">
                <IconListDetails />
                View issues
              </Link>
            </Button>
            <Button asChild>
              <Link href="/issues/new">
                <IconPlus />
                New issue
              </Link>
            </Button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Total
              </CardTitle>
              <CardDescription>Issues created</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-medium tabular-nums">
                {data.issues.length}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Active
              </CardTitle>
              <CardDescription>Work not completed</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-medium tabular-nums">
                {activeIssueCount}
              </p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="text-sm text-muted-foreground">
                Blocked
              </CardTitle>
              <CardDescription>Waiting on dependencies</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-medium tabular-nums">
                {data.blockedIssueIds.length}
              </p>
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  )
}
