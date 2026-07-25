import assert from "node:assert/strict"
import { test } from "node:test"

import {
  filterSlashCommands,
  slashCommandQuery,
  slashCommandsForProvider,
} from "./slash-commands"

test("slashCommandQuery only matches a slash token on the first line", () => {
  assert.equal(slashCommandQuery("/pla"), "/pla")
  assert.equal(slashCommandQuery("/plan now"), null)
  assert.equal(slashCommandQuery(" /plan"), null)
  assert.equal(slashCommandQuery("/plan\nextra"), "/plan")
})

test("filterSlashCommands limits matches and keeps prefix order", () => {
  const commands = Array.from({ length: 10 }, (_, index) => ({
    name: `/cmd-${index}`,
    description: String(index),
  }))

  assert.deepEqual(
    filterSlashCommands(commands, "/cmd").map((command) => command.name),
    commands.slice(0, 8).map((command) => command.name)
  )
})

test("slashCommandsForProvider selects provider-specific command sets", () => {
  assert.ok(
    slashCommandsForProvider("codex").some(
      (command) => command.name === "/reasoning"
    )
  )
  assert.ok(
    slashCommandsForProvider("claude_code").some(
      (command) => command.name === "/memory"
    )
  )
})
