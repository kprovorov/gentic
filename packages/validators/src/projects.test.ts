import assert from "node:assert/strict"
import { test } from "node:test"

import { projectSchema } from "./projects.js"

const baseInput = {
  name: "Gentic",
  repo: "kprovorov/gentic",
  setup_script: null,
  auto_respond_to_reviews: true,
  automatic_review_instructions: null,
}

test("projectSchema defaults Automatic Review to disabled with no provider/model", () => {
  const values = projectSchema.parse(baseInput)

  assert.equal(values.automatic_review_enabled, false)
  assert.equal(values.automatic_review_provider, null)
  assert.equal(values.automatic_review_model, null)
  assert.equal(values.automatic_review_instructions, null)
})

test("projectSchema accepts an explicit provider/model pairing", () => {
  const values = projectSchema.parse({
    ...baseInput,
    automatic_review_enabled: true,
    automatic_review_provider: "claude_code",
    automatic_review_model: "claude-opus-5",
  })

  assert.equal(values.automatic_review_enabled, true)
  assert.equal(values.automatic_review_provider, "claude_code")
  assert.equal(values.automatic_review_model, "claude-opus-5")
})

test("projectSchema rejects a model that does not belong to the selected provider", () => {
  assert.throws(() =>
    projectSchema.parse({
      ...baseInput,
      automatic_review_provider: "codex",
      automatic_review_model: "claude-opus-5",
    })
  )
})

test('projectSchema allows any stored model when the provider is "Same as Issue"', () => {
  // The provider is unknown ahead of time, so the model can't be validated
  // against a provider's option list until one is chosen.
  const values = projectSchema.parse({
    ...baseInput,
    automatic_review_provider: null,
    automatic_review_model: "claude-opus-5",
  })

  assert.equal(values.automatic_review_provider, null)
  assert.equal(values.automatic_review_model, "claude-opus-5")
})

test("projectSchema normalizes blank Automatic Review instructions to null", () => {
  const values = projectSchema.parse({
    ...baseInput,
    automatic_review_instructions: "   ",
  })

  assert.equal(values.automatic_review_instructions, null)
})

test("projectSchema preserves additive Automatic Review instructions", () => {
  const values = projectSchema.parse({
    ...baseInput,
    automatic_review_instructions: "Focus on security and test coverage.",
  })

  assert.equal(
    values.automatic_review_instructions,
    "Focus on security and test coverage."
  )
})
