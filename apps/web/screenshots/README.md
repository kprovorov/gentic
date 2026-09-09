# Marketing screenshots

These fixtures render the application's real `IssuesView`, `AppSidebar`,
`SiteHeader`, `NewIssueDialog`/`IssueCreateForm`, `IssueDetailHeader`,
`IssueTimeline`, and `IssueDetailRail`. Only project data is fabricated.
They are outside `app/` and create no production route or authentication bypass.

`prepare.mjs` makes a disposable copy of `apps/web` under `apps/.capture-*`.
It excludes environment files and build caches, reuses installed dependencies,
and substitutes the fixture routes/layout in the copy. The account footer and
realtime subscriptions are omitted. A throwing backend client prevents uploads;
Playwright also blocks non-GET and API requests. Production files are not edited.

From the repository root:

```sh
node apps/web/screenshots/prepare.mjs
```

The script prints the disposable directory. In that directory, start Next.js
on loopback only (the timezone must match the browser):

```sh
TZ=UTC node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3200
```

In a second terminal, from the repository root, with `playwright-cli` installed:

```sh
playwright-cli -s=gentic-capture open http://127.0.0.1:3200/issues --config=apps/web/screenshots/playwright.json
playwright-cli -s=gentic-capture run-code --filename=apps/web/screenshots/capture.js
playwright-cli -s=gentic-capture close
```

Stop the local server and remove the printed disposable directory afterward.
The four PNGs are written directly into `apps/landing/public/screenshots`.
The capture waits for fonts and stable frames, checks 2× pixel density, disables
animations, and exports PNG bytes directly from Playwright. No upscaling, JPEG
conversion, or UI text replacement is applied to the images. The composer crop
includes the full dialog and menu, measured after layout.

If the app's layout or model catalog changes, adjust the fixture/capture steps
and inspect all four images before using them on the landing page.
