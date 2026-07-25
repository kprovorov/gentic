import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@gentic/ui"

export function IssueStatus() {
  return (
    <Select defaultValue="in-progress" open>
      <SelectTrigger style={{ width: 220 }}>
        <SelectValue placeholder="Select status" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Status</SelectLabel>
          <SelectItem value="todo">To do</SelectItem>
          <SelectItem value="in-progress">In progress</SelectItem>
          <SelectItem value="ready-for-review">Ready for review</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value="merged">Merged</SelectItem>
        <SelectItem value="cancelled">Cancelled</SelectItem>
      </SelectContent>
    </Select>
  )
}

export function ProjectPicker() {
  return (
    <Select defaultValue="web" open>
      <SelectTrigger style={{ width: 240 }}>
        <SelectValue placeholder="Select a project" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          <SelectLabel>Active projects</SelectLabel>
          <SelectItem value="web">gentic/web</SelectItem>
          <SelectItem value="gentic">gentic/gentic</SelectItem>
          <SelectItem value="ui">gentic/ui</SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectGroup>
          <SelectLabel>Archived</SelectLabel>
          <SelectItem value="legacy-api" disabled>
            gentic/legacy-api
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}

export function AllStatuses() {
  return (
    <Select defaultValue="testing" open>
      <SelectTrigger style={{ width: 220 }}>
        <SelectValue placeholder="Select status" />
      </SelectTrigger>
      <SelectContent style={{ maxHeight: 260 }}>
        <SelectGroup>
          <SelectLabel>Pipeline</SelectLabel>
          <SelectItem value="draft">Draft</SelectItem>
          <SelectItem value="todo">To do</SelectItem>
          <SelectItem value="queued">Queued</SelectItem>
          <SelectItem value="held">On hold</SelectItem>
          <SelectItem value="in-progress">In progress</SelectItem>
          <SelectItem value="waiting-for-input">Waiting for input</SelectItem>
          <SelectItem value="testing">Testing</SelectItem>
          <SelectItem value="tests-failed">Tests failed</SelectItem>
          <SelectItem value="ready-for-review">Ready for review</SelectItem>
          <SelectItem value="changes-requested">Changes requested</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="merged">Merged</SelectItem>
          <SelectItem value="deploying">Deploying</SelectItem>
          <SelectItem value="deploy-failed">Deploy failed</SelectItem>
          <SelectItem value="validating">Validating</SelectItem>
          <SelectItem value="run-failed">Run failed</SelectItem>
          <SelectItem value="completed">Completed</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
