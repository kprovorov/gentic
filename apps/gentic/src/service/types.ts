export type ServiceScope = "user" | "system"

export interface ServiceStatus {
  state: "running" | "stopped" | "not-installed"
  pid?: number
  since?: Date
}

export interface ServiceInstallOptions {
  enableOnBoot: boolean
}

export interface ServiceLogsOptions {
  follow: boolean
}

export interface ServiceBackend {
  readonly name: string
  isAvailable(): boolean
  install(opts: ServiceInstallOptions): Promise<void>
  uninstall(): Promise<void>
  start(): Promise<void>
  stop(): Promise<void>
  restart(): Promise<void>
  status(): Promise<ServiceStatus>
  isEnabledOnBoot(): Promise<boolean>
  logs(opts: ServiceLogsOptions): Promise<void>
}
