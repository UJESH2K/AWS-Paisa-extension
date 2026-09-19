# Browser end-to-end tests

These load the **real unpacked extension** into headless Edge (or Chrome) and drive it over the DevTools protocol. What is asserted is the extension a user would install, not a mock of it.

No AWS account, credentials, or network access to AWS is involved. The suites run against local fixture pages that stand in for AWS console pages, plus a local stand-in API that builds its responses with the **real** `backend/src/report.py`, so the response shape cannot drift from production.

## Running

```bash
python tests/e2e/run.py            # all suites
python tests/e2e/run.py theme      # one suite
```

The runner copies `extension/` into `tests/e2e/.work/`, repoints the manifest at `localhost` instead of `console.aws.amazon.com`, starts the two local servers, runs each suite, and tears everything down. Exit code is non-zero if any suite fails.

Set `PAISA_BROWSER` if Edge/Chrome is not in a standard location.

## Suites

| Suite | What it covers |
|---|---|
| `badge` | The inline ₹ figures injected beside dollar amounts: placement, the maths, awkward layouts (`USD 12.34`, split `$`/number spans, shadow DOM, iframes), reading history, and staying quiet on pages that mention dollars but are not your bill |
| `panel` | The ₹ Bill button and panel: email sign-in, the bill and its breakdown, emailing a summary, refresh, persistence across reloads, sign-out, stale sessions, and an account with no connected role |
| `panel-noapi` | A build with no API URL: it must say so plainly and offer a clearly labelled sample, not a sign-in form that cannot work |
| `theme` | That the panel belongs on the page: follows the console's light/dark theme live, uses the console's type and colour, and re-attaches when the SPA removes it |

## Notes for anyone extending these

- **Derive expected values, don't hard-code them.** The suites read the FX rate the extension actually fetched and compute the expected rupee figure from it.
- **Use the `inr0`/`inr2` helpers for comparisons.** Node and the browser can disagree on currency spacing across ICU versions; comparing against hand-written literals produces fake failures.
- **Headings are uppercased by CSS**, so `panelDriver.has()` compares case-insensitively.
- The panel lives in a shadow root; reach it via `PANEL_SHADOW`, not `document.querySelector`.
