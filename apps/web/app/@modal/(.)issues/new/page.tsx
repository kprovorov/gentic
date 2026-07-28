import { getNewIssueData } from "@/app/queries"
import { NewIssueModal } from "@/app/issues/new/new-issue-modal"

export default async function NewIssueModalPage() {
  const initialData = await getNewIssueData()

  return <NewIssueModal initialData={initialData} />
}
