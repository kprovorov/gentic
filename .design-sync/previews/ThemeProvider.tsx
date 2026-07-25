import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Marker,
  MarkerContent,
  ThemeProvider,
} from "@gentic/ui"

export function Light() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
    >
      <Card style={{ maxWidth: 320 }}>
        <CardHeader>
          <CardTitle>Fix login redirect bug</CardTitle>
          <CardDescription>Themed in light mode</CardDescription>
        </CardHeader>
        <CardContent style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Marker variant="border">
            <MarkerContent>Status: Queued</MarkerContent>
          </Marker>
          <Button size="sm">Assign agent</Button>
        </CardContent>
      </Card>
    </ThemeProvider>
  )
}

export function Dark() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <div className="dark bg-background p-4">
        <Card style={{ maxWidth: 320 }}>
          <CardHeader>
            <CardTitle>Fix login redirect bug</CardTitle>
            <CardDescription>Themed in dark mode</CardDescription>
          </CardHeader>
          <CardContent
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            <Marker variant="border">
              <MarkerContent>Status: Queued</MarkerContent>
            </Marker>
            <Button size="sm">Assign agent</Button>
          </CardContent>
        </Card>
      </div>
    </ThemeProvider>
  )
}
