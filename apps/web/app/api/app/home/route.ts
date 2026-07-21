import { getHomeData } from "@/app/queries"

import { jsonQueryRoute } from "../_lib"

export const GET = jsonQueryRoute(({ context }) => getHomeData(context))
