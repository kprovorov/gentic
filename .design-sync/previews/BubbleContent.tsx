import { Bubble, BubbleContent, BubbleGroup, BubbleReactions } from "@gentic/ui"

export function Variants() {
  return (
    <BubbleGroup style={{ maxWidth: 360 }}>
      <Bubble variant="default">
        <BubbleContent>Default — primary color</BubbleContent>
      </Bubble>
      <Bubble variant="secondary">
        <BubbleContent>Secondary</BubbleContent>
      </Bubble>
      <Bubble variant="muted">
        <BubbleContent>Muted</BubbleContent>
      </Bubble>
      <Bubble variant="tinted">
        <BubbleContent>Tinted</BubbleContent>
      </Bubble>
      <Bubble variant="outline">
        <BubbleContent>Outline</BubbleContent>
      </Bubble>
      <Bubble variant="destructive">
        <BubbleContent>Destructive</BubbleContent>
      </Bubble>
    </BubbleGroup>
  )
}

export function AlignedConversation() {
  return (
    <BubbleGroup style={{ maxWidth: 360 }}>
      <Bubble align="start">
        <BubbleContent>Incoming message, aligned start.</BubbleContent>
      </Bubble>
      <Bubble align="end">
        <BubbleContent>Outgoing message, aligned end.</BubbleContent>
      </Bubble>
    </BubbleGroup>
  )
}

export function WithReactions() {
  return (
    <div style={{ position: "relative", width: "fit-content" }}>
      <Bubble variant="tinted">
        <BubbleContent>Nice, thanks for the quick fix!</BubbleContent>
      </Bubble>
      <BubbleReactions>👍 2</BubbleReactions>
    </div>
  )
}
