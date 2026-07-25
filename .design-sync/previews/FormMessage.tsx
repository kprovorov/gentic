import { useForm } from "react-hook-form"
import {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  Input,
  Button,
} from "@gentic/ui"

export function BasicField() {
  const form = useForm({ defaultValues: { title: "" } })

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <FormItem style={{ maxWidth: 320 }}>
            <FormLabel>Title</FormLabel>
            <FormControl>
              <Input {...field} placeholder="Review onboarding flow" />
            </FormControl>
            <FormDescription>
              Shown on the issue card and in agent runs.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  )
}

export function IssueSection() {
  const form = useForm({
    defaultValues: { title: "Fix login redirect bug", repo: "" },
  })

  return (
    <Form {...form}>
      <form
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 20,
          maxWidth: 320,
        }}
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input {...field} placeholder="Review onboarding flow" />
              </FormControl>
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="repo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Repo</FormLabel>
              <FormControl>
                <Input {...field} placeholder="kprovorov/gentic" />
              </FormControl>
              <FormDescription>owner/repo on GitHub.</FormDescription>
            </FormItem>
          )}
        />
        <Button type="submit" size="sm" style={{ justifySelf: "start" }}>
          Create issue
        </Button>
      </form>
    </Form>
  )
}

export function ValidationError() {
  const form = useForm({
    defaultValues: { repo: "not-a-repo" },
    errors: {
      repo: { type: "pattern", message: "Use the owner/repo format." },
    },
  })

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="repo"
        render={({ field }) => (
          <FormItem style={{ maxWidth: 320 }}>
            <FormLabel>Repo</FormLabel>
            <FormControl>
              <Input
                {...field}
                aria-invalid
                placeholder="kprovorov/gentic"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </Form>
  )
}
