import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { delimiter, join } from "node:path"
import { test } from "node:test"

import {
  detectHomebrew,
  detectLinuxPackageManager,
  detectPlatform,
  spawnInteractive,
} from "./installers.js"

test("detectPlatform returns supported platforms", () => {
  assert.equal(detectPlatform("darwin"), "darwin")
  assert.equal(detectPlatform("linux"), "linux")
})

test("detectPlatform rejects unsupported platforms", () => {
  assert.throws(() => detectPlatform("win32"), /Unsupported platform: win32/)
})

test("detectLinuxPackageManager returns the first supported manager on PATH", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gentic-installers-"))
  try {
    const dnf = join(dir, "dnf")
    const pacman = join(dir, "pacman")
    await writeFile(dnf, "#!/bin/sh\nexit 0\n")
    await writeFile(pacman, "#!/bin/sh\nexit 0\n")
    await chmod(dnf, 0o755)
    await chmod(pacman, 0o755)

    assert.equal(detectLinuxPackageManager(dir), "dnf")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("detectLinuxPackageManager skips non-executable matches", async () => {
  const aptDir = await mkdtemp(join(tmpdir(), "gentic-installers-apt-"))
  const dnfDir = await mkdtemp(join(tmpdir(), "gentic-installers-dnf-"))
  try {
    await writeFile(join(aptDir, "apt-get"), "#!/bin/sh\nexit 0\n")
    const dnf = join(dnfDir, "dnf")
    await writeFile(dnf, "#!/bin/sh\nexit 0\n")
    await chmod(dnf, 0o755)

    assert.equal(
      detectLinuxPackageManager([aptDir, dnfDir].join(delimiter)),
      "dnf"
    )
  } finally {
    await rm(aptDir, { recursive: true, force: true })
    await rm(dnfDir, { recursive: true, force: true })
  }
})

test("detectLinuxPackageManager returns null when no supported manager is found", () => {
  assert.equal(detectLinuxPackageManager(""), null)
})

test("detectHomebrew reports whether brew is executable on PATH", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gentic-installers-brew-"))
  try {
    const brew = join(dir, "brew")
    await writeFile(brew, "#!/bin/sh\nexit 0\n")
    await chmod(brew, 0o755)

    assert.equal(detectHomebrew(dir), true)
    assert.equal(detectHomebrew(""), false)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("spawnInteractive resolves for a zero exit code", async () => {
  await spawnInteractive(process.execPath, ["-e", "process.exit(0)"])
})

test("spawnInteractive rejects for a non-zero exit code", async () => {
  await assert.rejects(
    spawnInteractive(process.execPath, ["-e", "process.exit(7)"]),
    /exited with code 7/
  )
})
