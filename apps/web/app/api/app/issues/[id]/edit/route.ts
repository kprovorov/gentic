import { getIssueEditData } from "@/app/queries"

import { jsonQueryRoute } from "../../../_lib"

export const GET = jsonQueryRoute(({ context, params }) =>
  getIssueEditData(params.id, context)
)
