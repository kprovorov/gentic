import type {
  HomeData,
  IssueDetailData,
  IssueEdit,
  IssuesData,
  ProjectOption,
  SettingsData,
} from "./queries"

type ApiErrorBody = {
  error?: {
    code?: string
    message?: string
  }
}

export class ApiQueryError extends Error {
  readonly status: number
  readonly code: string

  constructor({
    status,
    code,
    message,
  }: {
    status: number
    code: string
    message: string
  }) {
    super(message)
    this.name = "ApiQueryError"
    this.status = status
    this.code = code
  }
}

const queryRequestInit: RequestInit = {
  credentials: "same-origin",
  headers: {
    Accept: "application/json",
  },
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, queryRequestInit)

  if (!response.ok) {
    let body: ApiErrorBody = {}
    try {
      body = (await response.json()) as ApiErrorBody
    } catch {
      // Ignore malformed error payloads and surface the status below.
    }

    throw new ApiQueryError({
      status: response.status,
      code: body.error?.code ?? "request_failed",
      message: body.error?.message ?? "Unable to load data",
    })
  }

  return (await response.json()) as T
}

export const fetchHomeData = () => getJson<HomeData>("/api/app/home")

export const fetchIssuesData = () => getJson<IssuesData>("/api/app/issues")

export const fetchSettingsData = () =>
  getJson<SettingsData>("/api/app/settings")

export const fetchNewIssueData = () =>
  getJson<{ projects: ProjectOption[] }>("/api/app/issues/new")

export const fetchIssueDetailData = (id: string) =>
  getJson<IssueDetailData>(`/api/app/issues/${encodeURIComponent(id)}`)

export const fetchIssueEditData = (id: string) =>
  getJson<IssueEdit>(`/api/app/issues/${encodeURIComponent(id)}/edit`)
