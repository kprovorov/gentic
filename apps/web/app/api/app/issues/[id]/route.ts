import { getIssueDetailData } from "@/app/queries"

import { jsonQueryRoute } from "../../_lib"

export const GET = jsonQueryRoute(({ context, params }) =>
  getIssueDetailData(params.id, context)
)
