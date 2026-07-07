export function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}
