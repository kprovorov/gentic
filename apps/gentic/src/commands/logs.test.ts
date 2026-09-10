import assert from "node:assert/strict"
import { test } from "node:test"

import { parseLines } from "./logs.js"

test("parseLines accepts a positive whole number", () => {
  assert.equal(parseLines("250"), 250)
})

test("parseLines rejects values that would widen or empty the window", () => {
  for (const value of ["0", "-5", "abc", "", "1.5", "all"]) {
    assert.throws(() => parseLines(value), /positive whole number/, `accepted ${value}`)
  }
})
