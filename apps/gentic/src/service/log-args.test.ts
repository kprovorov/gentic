import assert from "node:assert/strict"
import { test } from "node:test"

import { journalctlArgs, tailArgs } from "./log-args.js"

test("journalctl reads a bounded window instead of the whole journal", () => {
  assert.deepEqual(journalctlArgs(["--user"], "gentic.service", { follow: false, lines: 100 }), [
    "--user",
    "-u",
    "gentic.service",
    "-n",
    "100",
    "--no-pager",
  ])
})

test("journalctl keeps the line window when following", () => {
  assert.deepEqual(journalctlArgs([], "gentic.service", { follow: true, lines: 50 }), [
    "-u",
    "gentic.service",
    "-n",
    "50",
    "-f",
  ])
})

test("tail shows the requested number of lines", () => {
  assert.deepEqual(tailArgs("/var/log/gentic.log", { follow: false, lines: 100 }), [
    "-n",
    "100",
    "/var/log/gentic.log",
  ])
})

test("tail keeps the line window when following", () => {
  assert.deepEqual(tailArgs("/var/log/gentic.log", { follow: true, lines: 25 }), [
    "-n",
    "25",
    "-f",
    "/var/log/gentic.log",
  ])
})
