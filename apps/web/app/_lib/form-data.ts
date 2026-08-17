import { z } from "zod"

export function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

export function getCheckbox(formData: FormData, key: string) {
  return formData.get(key) === "on"
}

/**
 * Reads a field that must carry a uuid, throwing when it does not. Server
 * Actions are a public entry point — the id arrives from whatever the browser
 * posted — so every one of them validates before it reaches a query.
 */
export function getUuid(formData: FormData, key: string) {
  return z.string().uuid().parse(getString(formData, key))
}
