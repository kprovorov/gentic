"use client"

import { useState } from "react"
import { AgentMark, Icon } from "@/components/icons"

const stages = [
  {
    label: "Write an issue",
    short: "Issue",
    status: "Draft",
    title: "A little context goes a long way.",
    detail:
      "Describe the outcome, add a reference, and pick the agent for the job.",
  },
  {
    label: "Let your agent build",
    short: "Build",
    status: "In progress",
    title: "Your idea is in good hands.",
    detail:
      "Follow the work as it happens. Jump into the conversation whenever you need to.",
  },
  {
    label: "Review the pull request",
    short: "Review",
    status: "Ready for review",
    title: "Real code. Ready for your eyes.",
    detail:
      "The changes arrive as a GitHub pull request. You decide what ships.",
  },
]

export function ProductPreview() {
  const [stage, setStage] = useState(1)
  const [provider, setProvider] = useState<"claude" | "codex">("claude")
  const current = stages[stage]!
  const agent = provider === "claude" ? "Claude Code" : "Codex"

  return (
    <div className="product-showcase" id="product-preview">
      <div className="preview-controls" aria-label="Explore the issue workflow">
        {stages.map((item, index) => (
          <button
            key={item.short}
            type="button"
            aria-pressed={stage === index}
            aria-controls="preview-content"
            onClick={() => setStage(index)}
            className={stage === index ? "stage-button active" : "stage-button"}
          >
            <span className="stage-number">{index + 1}</span>
            <span className="stage-label">{item.label}</span>
            <span className="stage-short">{item.short}</span>
            {index < 2 && <Icon name="chevron" className="stage-arrow" />}
          </button>
        ))}
      </div>
      <div className="product-window">
        <div className="window-bar">
          <span className="window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>
            <Icon name="globe" /> app.gentic.chat
          </span>
          <span className="preview-label">Interactive preview</span>
        </div>
        <div className="preview-app">
          <aside className="preview-sidebar" aria-label="Example workspace">
            <div className="workspace-name">
              <span className="workspace-avatar">S</span> Studio{" "}
              <span className="muted">⌄</span>
            </div>
            <div className="sidebar-item">
              <Icon name="layers" /> Overview
            </div>
            <div className="sidebar-item selected">
              <Icon name="issue" /> Issues <span>8</span>
            </div>
            <div className="sidebar-heading">PROJECTS</div>
            <div className="sidebar-item">
              <span className="project-dot violet" /> Web app
            </div>
            <div className="sidebar-item">
              <span className="project-dot peach" /> API
            </div>
            <div className="sidebar-worker">
              <span className="online-dot" />
              <span>
                Worker connected<small>Ready for your next idea</small>
              </span>
            </div>
          </aside>
          <div className="preview-main" id="preview-content">
            <div className="issue-breadcrumb">
              <span>Web app</span>
              <Icon name="chevron" />
              <span>WEB-24</span>
              <span className={`issue-status status-${stage}`}>
                <span />
                {current.status}
              </span>
            </div>
            <div className="issue-content">
              <h3>Add dark mode to the dashboard</h3>
              <div className="issue-tags">
                <span>
                  <span className="project-dot violet" /> Feature
                </span>
                <span>
                  <Icon name="layers" /> Web app
                </span>
              </div>
              {stage === 0 ? (
                <div className="draft-content">
                  <p>
                    Add a dark theme that follows the system preference. Include
                    a toggle in Settings and remember the user’s choice.
                  </p>
                  <div className="attachment">
                    <Icon name="paperclip" /> dashboard-reference.png{" "}
                    <span>Reference attached</span>
                  </div>
                  <div
                    className="agent-picker"
                    aria-label="Choose a demo agent"
                  >
                    {(["claude", "codex"] as const).map((item) => (
                      <button
                        type="button"
                        key={item}
                        aria-pressed={provider === item}
                        onClick={() => setProvider(item)}
                      >
                        <AgentMark provider={item} />
                        {item === "claude" ? "Claude Code" : "Codex"}
                        {provider === item && <Icon name="check" />}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="demo-run"
                    onClick={() => setStage(1)}
                  >
                    Run with {agent}
                    <Icon name="arrow" />
                  </button>
                </div>
              ) : (
                <div className="conversation">
                  <div className="conversation-author">
                    <AgentMark provider={provider} />
                    <strong>{agent}</strong>
                    <span>
                      {stage === 1 ? "Working on your issue" : "Work completed"}
                    </span>
                  </div>
                  <p>
                    {stage === 1
                      ? "I’ll check the existing theme setup, add dark mode, and make sure your preference stays with you."
                      : "Dark mode is ready. I’ve added the theme toggle, saved preferences, and tests for switching themes."}
                  </p>
                  <div className="task-list">
                    <div>
                      <span className="task-check">
                        <Icon name="check" />
                      </span>{" "}
                      Explore the dashboard and theme styles <span>Done</span>
                    </div>
                    <div>
                      <span className="task-check">
                        <Icon name="check" />
                      </span>{" "}
                      Add system preference and theme toggle <span>Done</span>
                    </div>
                    <div>
                      <span
                        className={stage === 1 ? "working-ring" : "task-check"}
                      >
                        {stage === 2 && <Icon name="check" />}
                      </span>{" "}
                      Test theme switching and persistence{" "}
                      <span>{stage === 1 ? "In progress" : "Done"}</span>
                    </div>
                  </div>
                  {stage === 1 ? (
                    <div className="code-activity">
                      <Icon name="code" />
                      <code>components/theme-toggle.tsx</code>
                      <span>
                        +38 <i>−4</i>
                      </span>
                    </div>
                  ) : (
                    <div className="preview-pr">
                      <span className="pr-symbol">
                        <Icon name="branch" />
                      </span>
                      <div>
                        <strong>Add dark mode to the dashboard</strong>
                        <small>Pull request #42 · Ready for review</small>
                      </div>
                      <span className="pr-check">
                        <Icon name="check" /> Checks passed
                      </span>
                    </div>
                  )}
                </div>
              )}
              {stage !== 0 && (
                <div className="preview-composer">
                  <Icon name="message" />
                  <span>
                    {stage === 1
                      ? "Send a follow-up without interrupting the flow…"
                      : "Ask for a change, keep the conversation going…"}
                  </span>
                  <span className="composer-arrow">
                    <Icon name="arrow" />
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="preview-caption" aria-live="polite">
        <strong>{current.title}</strong>
        <span>{current.detail}</span>
      </div>
    </div>
  )
}
