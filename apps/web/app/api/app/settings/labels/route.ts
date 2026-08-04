import { getSettingsLabelsData } from "@/app/queries"

import { getOptionalAuthenticatedContext } from "@/app/_lib/auth-context"
import { apiQueryNoStoreHeaders } from "../../api-query-route"

export async function GET(request: Request) {
  const context = await getOptionalAuthenticatedContext()

  if (!context) {
    return Response.json(
      { error: { code: "unauthorized", message: "Unauthorized" } },
      { status: 401, headers: apiQueryNoStoreHeaders }
    )
  }

  try {
    const { searchParams } = new URL(request.url)
    return Response.json(
      await getSettingsLabelsData(context, {
        search: searchParams.get("search") ?? undefined,
      }),
      { headers: apiQueryNoStoreHeaders }
    )
  } catch (error) {
    console.error(error)
    return Response.json(
      { error: { code: "internal", message: "Unable to load data" } },
      { status: 500, headers: apiQueryNoStoreHeaders }
    )
  }
}
