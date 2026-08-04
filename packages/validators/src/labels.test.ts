import assert from "node:assert/strict"
import test from "node:test"

import {
  createLabelSchema,
  labelColorSchema,
  labelPresetColors,
  updateLabelSchema,
} from "./labels"

test("label names trim, preserve display casing, and allow Unicode spaces", () => {
  const label = createLabelSchema.parse({
    name: "  Déjà vu Ready  ",
    color: "#1d4ed8",
  })

  assert.equal(label.name, "Déjà vu Ready")
  assert.equal(label.color, "#1D4ED8")
})

test("label names reject blank, overlong, and control characters", () => {
  assert.equal(createLabelSchema.safeParse({ name: "   " }).success, false)
  assert.equal(createLabelSchema.safeParse({ name: "a".repeat(51) }).success, false)
  assert.equal(createLabelSchema.safeParse({ name: "bad\nname" }).success, false)
})

test("label colors are canonical opaque hex values", () => {
  assert.equal(labelColorSchema.parse("#abc123"), "#ABC123")
  assert.equal(labelColorSchema.safeParse("#ABC123FF").success, false)
  assert.equal(labelColorSchema.safeParse("red").success, false)
})

test("update labels require a stable id and at least one mutable field", () => {
  assert.equal(
    updateLabelSchema.safeParse({
      id: "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2",
    }).success,
    false
  )
  assert.equal(
    updateLabelSchema.safeParse({
      id: "3f14e45f-ceea-467e-b7ea-05a3e2b3f4c2",
      color: "#3f3f46",
    }).success,
    true
  )
})

test("label palette exposes 48 preset colors", () => {
  assert.equal(labelPresetColors.length, 48)
  assert.equal(new Set(labelPresetColors).size, 48)
})
