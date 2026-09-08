"use client"

import { useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "@gentic/ui/toggle-group"
import { ProductScreenshot } from "@/components/product-screenshot"
import issuesScreenshot from "@/public/screenshots/issues.png"
import planningScreenshot from "@/public/screenshots/planning.png"

const views = {
  active: {
    label: "Building & reviewing",
    src: issuesScreenshot,
    alt: "Gentic demo workspace with issues in progress, testing, reviewing, approved, and merged, showing agent, priority, label, dependency, and pull-request pills",
  },
  planning: {
    label: "Planning & queued",
    src: planningScreenshot,
    alt: "Gentic demo workspace with waiting-for-input, queued, and draft tasks, including blocked work, priorities, and colored labels",
  },
}

export function ProductPreview() {
  const [view, setView] = useState<keyof typeof views>("active")
  const current = views[view]
  return (
    <figure className="product-showcase" id="product-preview">
      <ToggleGroup
        type="single"
        value={view}
        onValueChange={(value) => {
          if (value === "active" || value === "planning") setView(value)
        }}
        className="mx-auto mb-5"
        aria-label="Choose a workspace screenshot"
      >
        {Object.entries(views).map(([value, item]) => (
          <ToggleGroupItem
            key={value}
            value={value}
            aria-controls="workspace-screenshot"
          >
            {item.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <div id="workspace-screenshot" aria-live="polite">
        <ProductScreenshot
          src={current.src}
          alt={current.alt}
          sizes="(max-width: 1200px) calc(100vw - 40px), 1140px"
          eager
        />
      </div>
      <figcaption className="preview-caption">
        <strong>From the next idea to the next release.</strong>
        <span>The real Gentic interface, shown with example project data.</span>
      </figcaption>
    </figure>
  )
}
