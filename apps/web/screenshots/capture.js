// Run from the repository root with playwright-cli run-code --filename=...
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- evaluated by playwright-cli
async function capture(page) {
  const origin = "http://127.0.0.1:3200"
  const output = "apps/landing/public/screenshots"
  // The fixture browser can only read the local app. Never send a mutation.
  await page.unroute("**/*")
  await page.route("**/*", (route) => {
    const request = route.request()
    if (
      request.url().startsWith(origin + "/") &&
      request.method() === "GET" &&
      !request.url().startsWith(origin + "/api/")
    )
      return route.continue()
    return route.abort()
  })
  const ready = async () => {
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    const dpr = await page.evaluate(() => devicePixelRatio)
    if (dpr !== 2) throw new Error(`Expected 2x capture, received ${dpr}x`)
  }
  for (const [scene, filename, title] of [
    ["active", "issues.png", "Add dark mode to the dashboard"],
    ["planning", "planning.png", "Confirm the new onboarding flow"],
  ]) {
    await page.setViewportSize({ width: 1440, height: 1040 })
    await page.goto(`${origin}/issues?scene=${scene}`)
    await page.getByText(title, { exact: true }).waitFor()
    await ready()
    await page.screenshot({
      path: `${output}/${filename}`,
      type: "png",
      scale: "device",
      animations: "disabled",
    })
  }
  await page.setViewportSize({ width: 1440, height: 840 })
  await page.goto(
    `${origin}/issues/ORB-124/build-the-activity-feed?scene=review`
  )
  await page.getByText("Automatic review approved", { exact: true }).waitFor()
  await ready()
  await page.screenshot({
    path: `${output}/review.png`,
    type: "png",
    scale: "device",
    animations: "disabled",
    clip: { x: 256, y: 8, width: 1176, height: 824 },
  })

  await page.setViewportSize({ width: 1440, height: 1040 })
  await page.goto(`${origin}/issues`)
  await page.getByRole("button", { name: "New issue", exact: true }).click()
  await page
    .getByRole("textbox", { name: "Body", exact: true })
    .fill(
      "Add dark mode to the dashboard. Follow the system preference, add a theme switcher, and remember the choice across visits."
    )
  await page.getByRole("button", { name: "Project", exact: true }).click()
  await page
    .getByRole("menuitem", { name: "Orbit orbit/web", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Choose agent and model", exact: true })
    .click()
  await page
    .getByRole("menuitem", { name: "Claude Sonnet 5", exact: true })
    .click()
  await page
    .getByRole("button", { name: "Choose agent and model", exact: true })
    .click()
  await ready()
  const dialog = await page.getByRole("dialog").boundingBox()
  const menu = await page
    .getByRole("menu", { name: "Choose agent and model" })
    .boundingBox()
  if (!dialog || !menu) throw new Error("Composer or model menu is missing")
  const x = Math.floor(Math.min(dialog.x, menu.x) - 12)
  const y = Math.floor(Math.min(dialog.y, menu.y) - 12)
  const right = Math.ceil(
    Math.max(dialog.x + dialog.width, menu.x + menu.width) + 12
  )
  const bottom = Math.ceil(
    Math.max(dialog.y + dialog.height, menu.y + menu.height) + 12
  )
  await page.screenshot({
    path: `${output}/agents.png`,
    type: "png",
    scale: "device",
    animations: "disabled",
    clip: { x, y, width: right - x, height: bottom - y },
  })
}
