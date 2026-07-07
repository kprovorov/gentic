import { getNewIssueData } from "@/app/queries"

import { NewIssueView } from "./new-issue-view"

export default async function NewIssuePage() {
  const initialData = await getNewIssueData()

  return <NewIssueView initialData={initialData} />
}
