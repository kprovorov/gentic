import {
  Bubble,
  BubbleContent,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "@gentic/ui"

export function Conversation() {
  return (
    <MessageGroup style={{ maxWidth: 480 }}>
      <Message>
        <MessageAvatar>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "9999px",
              background: "var(--primary)",
              color: "var(--primary-foreground)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            AI
          </div>
        </MessageAvatar>
        <MessageContent>
          <MessageHeader>Agent</MessageHeader>
          <Bubble variant="muted">
            <BubbleContent>
              I found the bug — the auth callback route redirects before the
              session cookie is set. Opening a fix now.
            </BubbleContent>
          </Bubble>
          <MessageFooter>2m ago</MessageFooter>
        </MessageContent>
      </Message>
      <Message align="end">
        <MessageContent>
          <Bubble align="end">
            <BubbleContent>Sounds good, go ahead.</BubbleContent>
          </Bubble>
          <MessageFooter>1m ago</MessageFooter>
        </MessageContent>
      </Message>
    </MessageGroup>
  )
}

export function SingleMessage() {
  return (
    <Message style={{ maxWidth: 420 }}>
      <MessageAvatar>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: "9999px",
            background: "var(--muted)",
          }}
        />
      </MessageAvatar>
      <MessageContent>
        <MessageHeader>Kirill</MessageHeader>
        <Bubble variant="outline">
          <BubbleContent>Can you rerun the failing test suite?</BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}
