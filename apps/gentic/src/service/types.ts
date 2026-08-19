export type ServiceScope = "user" | "system"

/**
 * The subset of `promisify(execFile)` the service backends use. Injecting it
 * lets the tests assert which `launchctl`/`systemctl` commands a backend runs
 * without shelling out to a real service manager.
 */
export type ExecFn = (
  file: string,
  args: string[],
  options?: { env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>

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
  reload(): Promise<void>
  restart(): Promise<void>
  status(): Promise<ServiceStatus>
  isEnabledOnBoot(): Promise<boolean>
  logs(opts: ServiceLogsOptions): Promise<void>
}
