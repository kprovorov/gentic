import { getIssuesData } from "@/app/queries"

import { jsonQueryRoute } from "../_lib"

export const GET = jsonQueryRoute(({ context }) => getIssuesData(context))
