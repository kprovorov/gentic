type ApiContext = unknown

type ApiRouteContext = {
  params?: Promise<Record<string, string>>
}

type ApiQueryRouteOptions<TContext extends ApiContext> = {
  getContext: () => Promise<TContext | null>
  isNotFoundError: (error: unknown) => boolean
  logError?: (error: unknown) => void
}

export const apiQueryNoStoreHeaders = {
  "Cache-Control": "private, no-store",
} as const

export function createJsonQueryHandler<TContext extends ApiContext, TResult>(
  read: (input: {
    context: TContext
    params: Record<string, string>
  }) => Promise<TResult>,
  options: ApiQueryRouteOptions<TContext>
) {
  return async function GET(
    _request: Request,
    routeContext: ApiRouteContext = {}
  ) {
    const context = await options.getContext()

    if (!context) {
      return Response.json(
        { error: { code: "unauthorized", message: "Unauthorized" } },
        { status: 401, headers: apiQueryNoStoreHeaders }
      )
    }

    try {
      return Response.json(
        await read({
          context,
          params: (await routeContext.params) ?? {},
        }),
        { headers: apiQueryNoStoreHeaders }
      )
    } catch (error) {
      if (options.isNotFoundError(error)) {
        return Response.json(
          {
            error: {
              code: "not_found",
              message: error instanceof Error ? error.message : "Not found",
            },
          },
          { status: 404, headers: apiQueryNoStoreHeaders }
        )
      }

      options.logError?.(error)
      return Response.json(
        { error: { code: "internal", message: "Unable to load data" } },
        { status: 500, headers: apiQueryNoStoreHeaders }
      )
    }
  }
}
