import { z } from "zod"

const controlCharacterPattern = /\p{Cc}/u

export const labelPresetColors = [
  "#B91C1C",
  "#DC2626",
  "#EF4444",
  "#F97316",
  "#EA580C",
  "#C2410C",
  "#A16207",
  "#CA8A04",
  "#EAB308",
  "#65A30D",
  "#16A34A",
  "#15803D",
  "#047857",
  "#0F766E",
  "#0D9488",
  "#0891B2",
  "#0284C7",
  "#0369A1",
  "#2563EB",
  "#1D4ED8",
  "#4338CA",
  "#4F46E5",
  "#7C3AED",
  "#6D28D9",
  "#9333EA",
  "#A21CAF",
  "#C026D3",
  "#DB2777",
  "#BE185D",
  "#E11D48",
  "#9F1239",
  "#881337",
  "#7F1D1D",
  "#78350F",
  "#713F12",
  "#365314",
  "#14532D",
  "#064E3B",
  "#134E4A",
  "#164E63",
  "#0C4A6E",
  "#1E3A8A",
  "#312E81",
  "#4C1D95",
  "#581C87",
  "#701A75",
  "#831843",
  "#3F3F46",
] as const

// Transforms can't be represented in JSON Schema (Zod's toJSONSchema throws),
// so callers building a JSON-Schema-facing shape (e.g. MCP tool input/output
// schemas) must use this untransformed base rather than labelColorSchema.
export const labelColorFormatSchema = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Use a #RRGGBB color.")

export const labelColorSchema = labelColorFormatSchema.transform((value) =>
  value.toUpperCase()
)

export const labelNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .refine((value) => !controlCharacterPattern.test(value), {
    message: "Label names cannot contain control characters.",
  })

export const createLabelSchema = z.object({
  name: labelNameSchema,
  color: labelColorSchema.optional(),
})

export const updateLabelSchema = z
  .object({
    id: z.string().uuid(),
    name: labelNameSchema.optional(),
    color: labelColorSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined, {
    message: "Provide a label name or color.",
  })

export type LabelColor = z.infer<typeof labelColorSchema>
export type CreateLabelValues = z.infer<typeof createLabelSchema>
export type UpdateLabelValues = z.infer<typeof updateLabelSchema>
