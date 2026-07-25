import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@gentic/ui"

export function Default() {
  return (
    <Card style={{ maxWidth: 360 }}>
      <CardHeader>
        <CardTitle>Fix login redirect bug</CardTitle>
        <CardDescription>gentic/web · opened 2 days ago</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm">
            ⋯
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <p style={{ margin: 0 }}>
          Users are redirected to the wrong page after signing in with an
          expired session. Needs a fix in the auth callback route.
        </p>
      </CardContent>
      <CardFooter style={{ gap: 8 }}>
        <Button size="sm">Assign agent</Button>
        <Button size="sm" variant="outline">
          View issue
        </Button>
      </CardFooter>
    </Card>
  )
}

export function Small() {
  return (
    <Card size="sm" style={{ maxWidth: 320 }}>
      <CardHeader>
        <CardTitle>Add rate limiting</CardTitle>
        <CardDescription>Backlog</CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ margin: 0 }}>Compact card, tighter internal spacing.</p>
      </CardContent>
    </Card>
  )
}

export function WithoutFooter() {
  return (
    <Card style={{ maxWidth: 320 }}>
      <CardHeader>
        <CardTitle>Draft PR ready for review</CardTitle>
        <CardDescription>gentic/gentic #482</CardDescription>
      </CardHeader>
      <CardContent>
        <p style={{ margin: 0 }}>
          No footer actions — just header and body content.
        </p>
      </CardContent>
    </Card>
  )
}
