import {
  Bubble,
  BubbleContent,
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@gentic/ui"

function AgentMessage({
  children,
  time,
}: {
  children: React.ReactNode
  time: string
}) {
  return (
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
          <BubbleContent>{children}</BubbleContent>
        </Bubble>
        <MessageFooter>{time}</MessageFooter>
      </MessageContent>
    </Message>
  )
}

function UserMessage({
  children,
  time,
}: {
  children: React.ReactNode
  time: string
}) {
  return (
    <Message align="end">
      <MessageContent>
        <Bubble align="end">
          <BubbleContent>{children}</BubbleContent>
        </Bubble>
        <MessageFooter>{time}</MessageFooter>
      </MessageContent>
    </Message>
  )
}

export function Default() {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="start">
      <MessageScroller
        className="h-[28rem] max-h-[28rem]"
        style={{ maxWidth: 480 }}
      >
        <MessageScrollerViewport className="pr-1">
          <MessageScrollerContent className="gap-3">
            <MessageScrollerItem messageId="msg-1">
              <AgentMessage time="8m ago">
                I found the bug — the auth callback route redirects before
                the session cookie is set. Opening a fix now.
              </AgentMessage>
            </MessageScrollerItem>
            <MessageScrollerItem messageId="msg-2">
              <UserMessage time="7m ago">
                Sounds good, go ahead.
              </UserMessage>
            </MessageScrollerItem>
            <MessageScrollerItem messageId="msg-3">
              <AgentMessage time="5m ago">
                Fix pushed to a branch. Running the test suite now to
                confirm the redirect works for both expired and missing
                sessions.
              </AgentMessage>
            </MessageScrollerItem>
            <MessageScrollerItem messageId="msg-4">
              <UserMessage time="3m ago">
                Can you rerun the failing test suite once more?
              </UserMessage>
            </MessageScrollerItem>
            <MessageScrollerItem messageId="msg-5">
              <AgentMessage time="1m ago">
                All tests pass. Opened a PR — ready for review.
              </AgentMessage>
            </MessageScrollerItem>
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}
