import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@gentic/ui"

export function OnButton() {
  return (
    <TooltipProvider>
      <Tooltip open>
        <TooltipTrigger asChild>
          <Button variant="outline">Hover me</Button>
        </TooltipTrigger>
        <TooltipContent>Assign this issue to an agent</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function OnIconButton() {
  return (
    <TooltipProvider>
      <Tooltip open defaultOpen>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            ⋯
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">More actions</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
