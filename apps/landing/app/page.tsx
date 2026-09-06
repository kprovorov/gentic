import { Button } from "@gentic/ui/button"
import { Card, CardContent } from "@gentic/ui/card"
import { Bubble, BubbleContent } from "@gentic/ui/bubble"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@gentic/ui/collapsible"
import Link from "next/link"
import { Logo } from "@/components/logo"
import { AgentMark, BrandMark, Icon } from "@/components/icons"
import { ProductPreview } from "@/components/product-preview"

const appUrl = "https://app.gentic.chat"
const githubUrl = "https://github.com/kprovorov/gentic"
const docsUrl = `${githubUrl}/tree/main/docs`

const questions = [
  {
    question: "What is Gentic?",
    answer:
      "Gentic is a workspace for managing AI coding agents. Create issues, assign them to Claude Code or Codex, follow their progress, and review the resulting GitHub pull requests from one place.",
  },
  {
    question: "Where do my agents run?",
    answer:
      "Agents run through a Gentic worker on a machine, server, or VM you control. Each issue gets an isolated working directory. You connect the worker to the web app and configure access to your repositories and coding agents.",
  },
  {
    question: "Do I need my own Claude Code or Codex account?",
    answer:
      "Yes. Gentic uses the coding agents installed and authenticated on your worker. Bring your existing Claude Code or Codex credentials; Gentic coordinates their work.",
  },
  {
    question: "Can I talk to an agent while it works?",
    answer:
      "Yes. Send follow-up messages and attachments from the issue conversation while the agent is running. You can also resume a finished issue with a new message, keeping the existing conversation context.",
  },
  {
    question: "Does Gentic automatically merge my code?",
    answer:
      "You decide what ships. Gentic can publish successful changes as pull requests and track their checks and reviews. You review and merge through your existing GitHub workflow.",
  },
]

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link href="/" className="brand" aria-label="Gentic home">
          <Logo className="brand-logo" />
          <span>Gentic</span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href={docsUrl}>
            Documentation <span aria-hidden="true">↗</span>
          </a>
        </nav>
        <div className="header-actions">
          <Button asChild variant="ghost" className="max-[380px]:hidden">
            <a href={`${appUrl}/login`}>Log in</a>
          </Button>
          <Button asChild>
            <a href={appUrl}>
              Open Gentic <Icon name="arrow" />
            </a>
          </Button>
        </div>
      </header>
      <main id="main">
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <a className="hero-eyebrow" href={githubUrl}>
              <span className="online-dot" /> A little more building. A lot less
              juggling. <Icon name="arrow" />
            </a>
            <h1 id="hero-heading">
              Your next idea.
              <br />
              <span>Already in progress.</span>
            </h1>
            <p>
              A home for your AI coding agents. Turn issues into working code
              <br className="desktop-break" /> with Claude Code and Codex, and
              keep the whole picture in view.
            </p>
            <div className="hero-actions">
              <Button asChild size="lg">
                <a href={appUrl}>
                  Start building <Icon name="arrow" />
                </a>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#how-it-works">
                  See how it works{" "}
                  <span className="play-icon" aria-hidden="true">
                    ▷
                  </span>
                </a>
              </Button>
            </div>
            <div className="hero-note">
              Your agents. Your infrastructure. Your call.
            </div>
          </div>
          <ProductPreview />
        </section>
        <section
          className="integrations page-width"
          aria-label="Supported tools"
        >
          <p>THE TOOLS YOU TRUST. A WORKFLOW THAT CONNECTS THEM.</p>
          <div className="integration-list">
            <span>
              <AgentMark provider="claude" />
              Claude Code
            </span>
            <span>
              <AgentMark provider="codex" />
              Codex
            </span>
            <span>
              <BrandMark brand="github" />
              GitHub
            </span>
            <span>
              <BrandMark brand="mcp" />
              MCP
            </span>
            <span>
              <Icon name="server" />
              Your infrastructure
            </span>
          </div>
        </section>
        <section
          className="features page-width section-space"
          id="features"
          aria-labelledby="features-heading"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">LESS COORDINATING. MORE CREATING.</span>
              <h2 id="features-heading">
                All the moving parts.
                <br />
                <span>One calm workspace.</span>
              </h2>
            </div>
            <p>
              From the first “what if” to the final review,
              <br className="desktop-break" /> keep your agents and your work
              together.
            </p>
          </div>
          <div className="feature-grid">
            <Card className="feature-card agent-feature">
              <CardContent>
                <div className="feature-copy">
                  <span className="feature-icon">
                    <Icon name="code" />
                  </span>
                  <h3>The right agent for every issue.</h3>
                  <p>
                    Choose Claude Code or Codex for each piece of work. Use the
                    agents you already know, with the context they need.
                  </p>
                </div>
                <div
                  className="agent-cards"
                  aria-label="Claude Code and Codex are supported"
                >
                  <div className="agent-option">
                    <AgentMark provider="claude" />
                    <div>
                      <strong>Claude Code</strong>
                      <small>Anthropic</small>
                    </div>
                    <span className="agent-ready">Ready</span>
                  </div>
                  <div className="agent-option">
                    <AgentMark provider="codex" />
                    <div>
                      <strong>Codex</strong>
                      <small>OpenAI</small>
                    </div>
                    <span className="agent-ready">Ready</span>
                  </div>
                  <span className="mini-note">
                    Different strengths. Same workspace.
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card className="feature-card conversation-feature">
              <CardContent>
                <div className="feature-copy">
                  <span className="feature-icon">
                    <Icon name="message" />
                  </span>
                  <h3>Stay in the conversation.</h3>
                  <p>
                    Watch progress live. Add a detail, attach a reference, or
                    steer the work without starting over.
                  </p>
                </div>
                <div className="mini-chat">
                  <Bubble variant="tinted" align="end">
                    <BubbleContent>
                      Let’s make sure it works on mobile, too.
                      <span className="block text-right text-xs text-muted-foreground">
                        You
                      </span>
                    </BubbleContent>
                  </Bubble>
                  <div className="agent-bubble">
                    <AgentMark provider="claude" />
                    <span>
                      On it. I’ll add responsive layouts and check the smaller
                      breakpoints.
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="feature-card compact-feature">
              <CardContent>
                <span className="feature-icon">
                  <Icon name="layers" />
                </span>
                <h3>Give every idea a place.</h3>
                <p>
                  Organize work into projects and issues. Add labels,
                  attachments, and blocking dependencies so agents pick up work
                  in the right order.
                </p>
                <div className="dependency-example">
                  <span>
                    <Icon name="check" /> Build the API
                  </span>
                  <Icon name="arrow" />
                  <span>
                    <span className="project-dot violet" /> Connect the UI
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card className="feature-card compact-feature">
              <CardContent>
                <span className="feature-icon">
                  <Icon name="branch" />
                </span>
                <h3>Pull requests, without the chase.</h3>
                <p>
                  Automatically publish successful changes to GitHub. Follow
                  checks and reviews alongside the issue, then decide what’s
                  ready to merge.
                </p>
                <div className="feature-pr">
                  <Icon name="branch" />
                  <span>Ready for review</span>
                  <span className="tiny-check">
                    <Icon name="check" /> Checks passed
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card className="feature-card compact-feature">
              <CardContent>
                <span className="feature-icon">
                  <Icon name="server" />
                </span>
                <h3>Your machines. Working together.</h3>
                <p>
                  Run workers on infrastructure you control. See what’s
                  connected and process multiple issues in their own isolated
                  working directories.
                </p>
                <div className="worker-example">
                  <Icon name="server" />
                  <span>build-worker-01</span>
                  <span className="worker-online">
                    <span className="online-dot" /> Online
                  </span>
                </div>
              </CardContent>
            </Card>
            <Card className="feature-card compact-feature">
              <CardContent>
                <span className="feature-icon">
                  <Icon name="link" />
                </span>
                <h3>Fits right into your flow.</h3>
                <p>
                  Connect Gentic to an MCP-compatible assistant. Create issues,
                  organize projects, and queue agent work from the tools you
                  already use.
                </p>
                <div className="mcp-example">
                  <Icon name="terminal" />
                  <code>“Queue this up in Gentic.”</code>
                  <Icon name="arrow" />
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
        <section
          className="workflow-section"
          id="how-it-works"
          aria-labelledby="workflow-heading"
        >
          <div className="page-width">
            <div className="section-heading">
              <div>
                <span className="eyebrow">FROM IDEA TO PULL REQUEST</span>
                <h2 id="workflow-heading">
                  You set the direction.
                  <br />
                  <span>Your agents take it from there.</span>
                </h2>
              </div>
              <a
                className="text-link"
                href={`${githubUrl}/blob/main/docs/quickstart.mdx`}
              >
                Read the setup guide <Icon name="arrow" />
              </a>
            </div>
            <div className="workflow-grid">
              <article>
                <span className="workflow-number">01</span>
                <h3>Connect your workspace.</h3>
                <p>
                  Add your GitHub repository, connect a worker, and authenticate
                  your coding agents.
                </p>
                <div className="workflow-visual">
                  <BrandMark brand="github" />
                  <span className="connecting-line" />
                  <Logo className="small-gentic" />
                  <span className="connecting-line" />
                  <Icon name="server" />
                </div>
              </article>
              <article>
                <span className="workflow-number">02</span>
                <h3>Write it. Assign it. Let it run.</h3>
                <p>
                  Describe the outcome, add context, and choose Claude Code or
                  Codex. Follow along as the work happens.
                </p>
                <div className="workflow-visual">
                  <span className="workflow-pill">
                    <span className="online-dot" /> Agent is working
                  </span>
                </div>
              </article>
              <article>
                <span className="workflow-number">03</span>
                <h3>Review something real.</h3>
                <p>
                  Get a pull request, ask for changes, and merge when you’re
                  happy. Your next idea is already waiting.
                </p>
                <div className="workflow-visual">
                  <span className="workflow-pill merged-pill">
                    <Icon name="branch" /> Merged
                  </span>
                </div>
              </article>
            </div>
          </div>
        </section>
        <section
          className="faq page-width section-space"
          id="faq"
          aria-labelledby="faq-heading"
        >
          <div className="faq-heading">
            <span className="eyebrow">A FEW MORE DETAILS</span>
            <h2 id="faq-heading">Good questions.</h2>
            <p>Get to know your new workspace.</p>
            <a href={docsUrl} className="text-link">
              Explore the documentation <Icon name="arrow" />
            </a>
          </div>
          <div className="faq-list">
            {questions.map(({ question, answer }) => (
              <Collapsible key={question} className="border-b border-border">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    className="h-auto w-full justify-between rounded-none py-5 text-left whitespace-normal group"
                  >
                    {question}
                    <Icon
                      name="plus"
                      className="transition-transform group-data-[state=open]:rotate-45"
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <p className="pb-5 pr-5 text-sm leading-relaxed text-muted-foreground">
                    {answer}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </section>
        <section
          className="closing-section page-width"
          aria-labelledby="closing-heading"
        >
          <div className="closing-orbit" aria-hidden="true">
            <span />
            <span />
            <span />
            <Logo className="closing-logo" />
          </div>
          <span className="eyebrow">MAKE ROOM FOR YOUR NEXT IDEA</span>
          <h2 id="closing-heading">
            Less juggling.
            <br />
            More shipped.
          </h2>
          <p>You bring the ideas. Give your agents a place to build them.</p>
          <Button asChild size="lg">
            <a href={appUrl}>
              Start building with Gentic <Icon name="arrow" />
            </a>
          </Button>
        </section>
      </main>
      <footer className="site-footer page-width">
        <div>
          <Link href="/" className="brand" aria-label="Gentic home">
            <Logo className="brand-logo" />
            <span>Gentic</span>
          </Link>
          <p>A home for your AI coding agents.</p>
        </div>
        <nav aria-label="Footer navigation">
          <a href={appUrl}>
            Open app <span aria-hidden="true">↗</span>
          </a>
          <a href={docsUrl}>Documentation</a>
          <a href={githubUrl}>GitHub</a>
        </nav>
        <span className="copyright">© {new Date().getFullYear()} Gentic</span>
      </footer>
    </>
  )
}
