import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "@gentic/ui"

export function DeleteConfirmation() {
  return (
    <AlertDialog open>
      <AlertDialogTrigger asChild>
        <Button variant="destructive" size="sm">
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete 3 issues?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the selected issues. This action
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive">Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function WithMedia() {
  return (
    <AlertDialog open>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          Leave project
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <span style={{ fontSize: 24 }}>⚠️</span>
          </AlertDialogMedia>
          <AlertDialogTitle>Leave &quot;gentic/web&quot;?</AlertDialogTitle>
          <AlertDialogDescription>
            You&apos;ll lose access to this project&apos;s issues and won&apos;t
            be notified of future activity.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction>Leave project</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
