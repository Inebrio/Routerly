# Screenshot capture

Generates the dashboard screenshots used in `docs/assets/`. Runs the built
service against fake fixture data in a throwaway home directory, drives a
headless Chromium through Playwright, and writes one PNG per entry in
`manifest.json`.

## Prerequisites

- Node >= 20
- `npm install` from the repo root
- `npx playwright install chromium` (once per machine)
- The service and shared packages built: `npm run build --workspace=packages/shared && npm run build --workspace=packages/service && npm run build --workspace=packages/dashboard`

## Usage

Capture every shot in the manifest:

```
npm run screenshots
```

Capture a subset only, leaving every other file in `docs/assets/` untouched:

```
npm run screenshots -- --only screenshot-login,screenshot-overview
```

List every shot name without starting the service or the browser:

```
npm run screenshots -- --list
```

Exit code is `0` on full success, non-zero if any shot failed. A failed shot
never leaves a blank or partial PNG behind; the previous file (if any) is
left alone and the reason is printed to stderr.

`ROUTERLY_SCREENSHOT_PORT` pins the port the throwaway service listens on.
Left unset, it defaults to `47816`. The default is a fixed number rather than
a free port picked at runtime because the port is visible in the connection
snippets on the project page, and a port that changes every run makes those
screenshots differ byte-for-byte from one capture to the next. Override it
only when 47816 is genuinely taken; the captured images will then show
whatever port you passed.

## Adding a new shot

Add an entry to `manifest.json` with `name`, `path`, `clip` (`"full"` or
`"viewport"`), and `steps` (a list of `{ "click": "<selector>" }` or
`{ "fill": "<selector>", "value": "<text>" }`, run in order). Optionally add
`waitFor` with a selector to wait for instead of the default network-idle +
main-landmark wait. No script changes are needed for a new shot.

## Fixtures

Everything under `fixtures/` is fake data, reviewed for this purpose only.
Never point it at a real `ROUTERLY_HOME` or real credentials.

## Reproducibility

Framing (layout, viewport, element positions) is stable across two runs on
the same machine. Byte-identical output across different machines is not
guaranteed: font rendering varies by OS.
