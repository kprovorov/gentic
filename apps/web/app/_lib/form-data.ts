export function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === "string" ? value : ""
}

export function getCheckbox(formData: FormData, key: string) {
  return formData.get(key) === "on"
}
