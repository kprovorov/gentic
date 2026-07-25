import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Button,
} from "@gentic/ui"

export function Default() {
  return (
    <Sheet open>
      <SheetTrigger asChild>
        <Button variant="outline">Open issue</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Fix login redirect bug</SheetTitle>
          <SheetDescription>gentic/web · opened 2 days ago</SheetDescription>
        </SheetHeader>
        <div style={{ padding: "0 24px" }}>
          <p style={{ margin: 0 }}>
            Users are redirected to the wrong page after signing in with an
            expired session. Needs a fix in the auth callback route.
          </p>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">Close</Button>
          </SheetClose>
          <Button>Assign agent</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function Bottom() {
  return (
    <Sheet open>
      <SheetTrigger asChild>
        <Button variant="outline">Filter issues</Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>Filter by status</SheetTitle>
          <SheetDescription>
            Narrow the issues table down to matching results.
          </SheetDescription>
        </SheetHeader>
        <div style={{ padding: "0 24px" }}>
          <p style={{ margin: 0 }}>Todo · In progress · In review · Done</p>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
          <Button>Apply filters</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
