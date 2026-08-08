type Listener = () => void

let slotElement: HTMLElement | null = null
const listeners = new Set<Listener>()

export function registerSiteHeaderActionsSlot(element: HTMLElement | null) {
  slotElement = element
  listeners.forEach((listener) => listener())
}

export function subscribeSiteHeaderActionsSlot(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSiteHeaderActionsSlot() {
  return slotElement
}

export function getSiteHeaderActionsSlotServerSnapshot() {
  return null
}
