import { getNewIssueData } from "@/app/queries"

import { jsonQueryRoute } from "../../_lib"

export const GET = jsonQueryRoute(({ context }) => getNewIssueData(context))
