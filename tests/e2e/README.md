# Browser end-to-end tests

These load the **real unpacked extension** into headless Edge (or Chrome) and drive it over the DevTools protocol. What is asserted is the extension a user would install, not a mock of it.

No AWS account, credentials, or network access to AWS is involved. The suites run against local fixture pages that stand in for AWS console pages, plus a local stand-in API that builds its responses with the **real** `backend/src/report.py`, so the response shape cannot drift from production.

## Running

```bash
python tests/e2e/run.py              # all suites, against extension/
python tests/e2e/run.py theme        # one suite
python tests/e2e/run.py --from-zip   # against the packaged dist/ zip instead
```

`--from-zip` tests the artifact users actually install, and fails if the package is missing any file the source ships. Testing `extension/` proves the source works; it does not prove the package does.

The runner copies `extension/` into `tests/e2e/.work/`, repoints the manifest at `localhost` instead of `console.aws.amazon.com`, starts the local servers, runs each suite, and tears everything down. Exit code is non-zero if any suite fails.

The stand-in API accumulates state (sessions, settings, connected roles), so **each suite gets its own instance**. Sharing one made results depend on the order suites ran in: the popup suite passed alone and failed in a full run, because an earlier suite had already signed the same address in. Suites are verified to pass in reverse order too.

The suites are hermetic: the exchange rate comes from a local fixture via the build's `fxUrl`, not from a third-party API, so a throttled or unreachable FX service cannot fail the run.

Set `PAISA_BROWSER` if Edge/Chrome is not in a standard location.

## Suites

| Suite | What it covers |
|---|---|
| `badge` | The inline ₹ figures injected beside dollar amounts: placement, the maths, awkward layouts (`USD 12.34`, split `$`/number spans, shadow DOM, iframes), reading history, and staying quiet on pages that mention dollars but are not your bill |
| `panel` | The ₹ Bill button and panel: email sign-in, the bill and its breakdown, emailing a summary, refresh, persistence across reloads, sign-out, stale sessions, and an account with no connected role |
| `popup` | The toolbar popup: the same bill as the panel, signing in from the popup, and the settings-sync guarantee — a change there reaches the server, so the page badges, the panel and the emailed summary never disagree |
| `panel-noapi` | A build with no API URL: it must say so plainly and offer a clearly labelled sample, not a sign-in form that cannot work |
| `theme` | That the panel belongs on the page: follows the console's light/dark theme live, uses the console's type and colour, re-attaches when the SPA removes it, and stays out of the console's tab order until it is opened |

## Notes for anyone extending these

- **Derive expected values, don't hard-code them.** The suites read the FX rate the extension actually fetched and compute the expected rupee figure from it.
- **Use the `inr0` helper for comparisons, and `near()` for money the extension computed by a different route.** Node and the browser can disagree on currency spacing across ICU versions, and two correct paths to the same figure can round to different paise — `5 × 90 × 1.035 × 1.18` and `(52.30 − 47.30) × 90 × 1.2213` differ in the last digit. Comparing rendered money strings for exact equality produces failures that look like product bugs and are not.
- **Headings are uppercased by CSS**, so `panelDriver.has()` compares case-insensitively.
- The panel lives in a shadow root; reach it via `PANEL_SHADOW`, not `document.querySelector`.
- A content script runs in an isolated world, so patching `window.open` from `Runtime.evaluate` cannot observe it. Assert on the DOM the extension produced instead.
