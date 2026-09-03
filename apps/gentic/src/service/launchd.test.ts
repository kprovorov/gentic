import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, test } from "node:test"

import { LaunchdBackend } from "./launchd.js"
import type { ExecFn } from "./types.js"

const LABEL = "dev.gentic.agent"
const TARGET = `gui/${process.getuid?.() ?? 0}/${LABEL}`
const DOMAIN = `gui/${process.getuid?.() ?? 0}`

/**
 * Records every `launchctl` invocation and answers each subcommand from
 * `handlers` — a string is stdout, an Error is a non-zero exit. Unlisted
 * subcommands succeed with no output.
 */
function fakeExec(handlers: Record<string, string | Error> = {}) {
  const calls: string[][] = []
  const exec: ExecFn = async (file, args) => {
    calls.push([file, ...args])
    const handler = handlers[args[0] ?? ""]
    if (handler instanceof Error) throw handler
    return { stdout: handler ?? "", stderr: "" }
  }
  return { exec, calls }
}

const NOT_LOADED = new Error("Could not find service in domain")

function subcommands(calls: string[][]): string[] {
  return calls.map((call) => call.slice(1).join(" "))
}

let home: string
let originalHome: string | undefined

beforeEach(async () => {
  originalHome = process.env.HOME
  home = await mkdtemp(join(tmpdir(), "gentic-launchd-"))
  process.env.HOME = home
})

afterEach(async () => {
  process.env.HOME = originalHome
  await rm(home, { recursive: true, force: true })
})

async function writePlist(runAtLoad: boolean): Promise<void> {
  const dir = join(home, "Library", "LaunchAgents")
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, `${LABEL}.plist`),
    `<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>RunAtLoad</key><${runAtLoad ? "true" : "false"}/>
</dict></plist>`,
    "utf8",
  )
}

test("stop records a persistent disable so a reboot doesn't relaunch the host", async () => {
  await writePlist(true)
  const { exec, calls } = fakeExec()

  await new LaunchdBackend(exec).stop()

  // Order matters: bootout alone unloads the job only for this boot session.
  assert.deepEqual(subcommands(calls), [
    `disable ${TARGET}`,
    `print ${TARGET}`,
    `bootout ${TARGET}`,
  ])
})

test("stop disables the job even when it isn't currently loaded", async () => {
  await writePlist(true)
  const { exec, calls } = fakeExec({ print: NOT_LOADED })

  await new LaunchdBackend(exec).stop()

  assert.deepEqual(subcommands(calls), [`disable ${TARGET}`, `print ${TARGET}`])
})

test("stop touches nothing when the service was never installed", async () => {
  const { exec, calls } = fakeExec()

  await new LaunchdBackend(exec).stop()

  assert.deepEqual(calls, [])
})

test("start clears the disable before loading the job", async () => {
  await writePlist(true)
  const { exec, calls } = fakeExec({ print: NOT_LOADED })

  await new LaunchdBackend(exec).start()

  assert.deepEqual(subcommands(calls), [
    `enable ${TARGET}`,
    `print ${TARGET}`,
    `bootstrap ${DOMAIN} ${join(home, "Library", "LaunchAgents", `${LABEL}.plist`)}`,
  ])
})

test("start reports why launchctl refused to clear the disable", async () => {
  await writePlist(true)
  const { exec } = fakeExec({ enable: new Error("Operation not permitted") })

  await assert.rejects(
    new LaunchdBackend(exec).start(),
    /launchctl enable failed: Operation not permitted/,
  )
})

test("install clears a disable left behind by an earlier stop", async () => {
  const { exec, calls } = fakeExec({ print: NOT_LOADED })

  await new LaunchdBackend(exec).install({ enableOnBoot: true })

  const commands = subcommands(calls)
  assert.ok(
    commands.indexOf(`enable ${TARGET}`) < commands.indexOf(`bootstrap ${DOMAIN} ${join(home, "Library", "LaunchAgents", `${LABEL}.plist`)}`),
    `expected enable before bootstrap, got ${JSON.stringify(commands)}`,
  )
})

test("isEnabledOnBoot reports disabled while a launchctl override is set", async () => {
  await writePlist(true)

  for (const value of ["disabled", "true"]) {
    const { exec } = fakeExec({
      "print-disabled": `disabled services = {\n\t"${LABEL}" => ${value}\n}`,
    })
    assert.equal(
      await new LaunchdBackend(exec).isEnabledOnBoot(),
      false,
      `expected "=> ${value}" to read as disabled`,
    )
  }
})

test("isEnabledOnBoot follows RunAtLoad when no override is set", async () => {
  const { exec } = fakeExec({
    "print-disabled": `disabled services = {\n\t"com.example.other" => disabled\n}`,
  })

  await writePlist(true)
  assert.equal(await new LaunchdBackend(exec).isEnabledOnBoot(), true)

  await writePlist(false)
  assert.equal(await new LaunchdBackend(exec).isEnabledOnBoot(), false)
})
