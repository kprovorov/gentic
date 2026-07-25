import { getIssueDetailDataById } from "@/app/queries"

import { jsonQueryRoute } from "../../_lib"

export const GET = jsonQueryRoute(({ context, params }) =>
  getIssueDetailDataById(params.id, context)
)
