import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir, userInfo } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

import { SystemdBackend } from "./systemd.js"
import type { ExecFn } from "./types.js"

/**
 * Records every `systemctl`/`loginctl` invocation and answers each subcommand
 * from `handlers` — a string is stdout, an Error is a non-zero exit. Unlisted
 * subcommands succeed with no output.
 */
function fakeExec(handlers: Record<string, string | Error> = {}) {
  const calls: string[][] = []
  const exec: ExecFn = async (file, args) => {
    calls.push([file, ...args])
    const subcommand = args.find((arg) => !arg.startsWith("--")) ?? ""
    const handler = handlers[subcommand]
    if (handler instanceof Error) throw handler
    return { stdout: handler ?? "", stderr: "" }
  }
  return { exec, calls }
}

function commands(calls: string[][]): string[] {
  return calls.map((call) => call.join(" ").replace("--user ", ""))
}

let home: string
let originalHome: string | undefined

beforeEach(async () => {
  originalHome = process.env.HOME
  home = await mkdtemp(join(tmpdir(), "gentic-systemd-"))
  process.env.HOME = home
})

afterEach(async () => {
  process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

function unitPath(): string {
  return join(home, ".config", "systemd", "user", "gentic.service")
}

async function writeUnit(enableOnBoot: boolean): Promise<void> {
  await mkdir(join(home, ".config", "systemd", "user"), { recursive: true })
  await writeFile(
    unitPath(),
    `# gentic-enable-on-boot=${enableOnBoot}\n[Unit]\nDescription=Gentic agent host\n`,
    "utf8",
  )
}

test("stop disables the unit so it doesn't come back after a reboot", async () => {
  const { exec, calls } = fakeExec()

  await new SystemdBackend("user", exec).stop()

  // `systemctl stop` lasts only for this boot: default.target still wants the
  // unit, so without the disable it starts again at the next login.
  assert.deepEqual(commands(calls), [
    "systemctl stop gentic.service",
    "systemctl disable gentic.service",
  ])
})

test("start re-enables boot start after a stop disabled it", async () => {
  await writeUnit(true)
  const { exec, calls } = fakeExec({ "is-enabled": "disabled" })

  await new SystemdBackend("user", exec).start()

  assert.deepEqual(commands(calls), [
    "systemctl is-enabled gentic.service",
    "systemctl enable gentic.service",
    `loginctl enable-linger ${userInfo().username}`,
    "systemctl start gentic.service",
  ])
})

test("start leaves boot start off for a --no-boot install", async () => {
  await writeUnit(false)
  const { exec, calls } = fakeExec({ "is-enabled": "disabled" })

  await new SystemdBackend("user", exec).start()

  assert.deepEqual(commands(calls), ["systemctl start gentic.service"])
})

test("start skips the enable when systemd already agrees", async () => {
  await writeUnit(true)
  const { exec, calls } = fakeExec({
    "is-enabled": "enabled",
    "show-user": "Linger=yes",
  })

  await new SystemdBackend("user", exec).start()

  assert.deepEqual(commands(calls), [
    "systemctl is-enabled gentic.service",
    `loginctl show-user ${userInfo().username} --property=Linger`,
    "systemctl start gentic.service",
  ])
})

test("restart re-enables boot start after a stop disabled it", async () => {
  await writeUnit(true)
  const { exec, calls } = fakeExec({ "is-enabled": "disabled" })

  await new SystemdBackend("user", exec).restart()

  assert.ok(
    commands(calls).includes("systemctl enable gentic.service"),
    `expected an enable, got ${JSON.stringify(commands(calls))}`,
  )
  assert.equal(commands(calls).at(-1), "systemctl restart gentic.service")
})

test("restart on a missing unit leaves the enable to systemctl's own error", async () => {
  const { exec, calls } = fakeExec()

  await new SystemdBackend("user", exec).restart()

  assert.deepEqual(commands(calls), ["systemctl restart gentic.service"])
})

test("install records the boot preference in the unit file", async () => {
  const { exec, calls } = fakeExec()

  await new SystemdBackend("user", exec).install({ enableOnBoot: true })

  assert.match(await readFile(unitPath(), "utf8"), /^# gentic-enable-on-boot=true$/m)
  assert.ok(commands(calls).includes("systemctl enable gentic.service"))
})

test("install with --no-boot disables a unit an earlier install enabled", async () => {
  const { exec, calls } = fakeExec()

  await new SystemdBackend("user", exec).install({ enableOnBoot: false })

  assert.match(await readFile(unitPath(), "utf8"), /^# gentic-enable-on-boot=false$/m)
  assert.deepEqual(commands(calls), [
    "systemctl daemon-reload",
    "systemctl disable gentic.service",
  ])
})

test("start treats a unit predating the marker as boot-enabled", async () => {
  await mkdir(join(home, ".config", "systemd", "user"), { recursive: true })
  await writeFile(unitPath(), "[Unit]\nDescription=Gentic agent host\n", "utf8")
  const { exec, calls } = fakeExec({ "is-enabled": "disabled" })

  await new SystemdBackend("user", exec).start()

  assert.ok(commands(calls).includes("systemctl enable gentic.service"))
})
