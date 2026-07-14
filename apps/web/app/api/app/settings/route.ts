import { getSettingsData } from "@/app/queries"

import { jsonQueryRoute } from "../_lib"

export const GET = jsonQueryRoute(({ context }) => getSettingsData(context))
