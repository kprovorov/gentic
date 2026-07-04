import { z } from "zod"

export const projectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  repo: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/,
      "Use the format user/repo"
    ),
  setup_script: z
    .string()
    .trim()
    .max(10000)
    .transform((value) => (value.length > 0 ? value : null))
    .nullable(),
})

export type ProjectValues = z.infer<typeof projectSchema>

export const idSchema = z.string().uuid()
