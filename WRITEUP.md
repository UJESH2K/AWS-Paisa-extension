# Paisa — writeup

> **Status, stated up front.** The backend is written, unit-tested against mocked AWS, and validated as a SAM template, but it is **not deployed**. The AWS account provided for this project has not finished signup, so CloudFormation, Lambda, DynamoDB, API Gateway and SNS all answer `OptInRequired` and Cost Explorer answers `SubscriptionRequiredException`. Nothing in this document claims a running deployment. The extension works today without any backend, and says so on screen rather than showing figures it cannot justify.

## The problem, and who has it

An Indian developer opens the AWS console and sees `$47.30`. That is not what leaves their bank account. Three things happen between that number and the debit, and no AWS screen shows all three together:

1. **The exchange rate.** If the account is with AWS Inc rather than AISPL, the card is charged in USD and the bank converts at its own rate on the settlement date — not the rate on the day the usage happened, and not the rate on Google.
2. **The card's forex markup.** Indian cards typically add a markup on international transactions, commonly quoted in the 2–3.5% range depending on the issuer, plus GST on that fee. It appears on the card statement, never in the AWS console.
3. **GST.** Indian customers pay 18% GST on AWS services. Whether it lands on the AWS invoice or the card statement depends on which AWS entity the account belongs to, and most people building their first project have no idea which one they signed up with.

So `$47.30` is really somewhere north of ₹4,900, and you find out three weeks later. For a student on the free tier, or a two-person startup watching runway, that gap between the screen and the bank is the whole reason cloud cost feels unpredictable.

AWS is not going to fix this: the console is a global product and it correctly shows the account's billed currency. The fix belongs next to the console, not inside it.

**Who it is for**, in order: students and first-time builders on the free tier who are frightened of the bill; two-to-ten-person Indian startups where one person owns the AWS account and finance asks "what will this cost us this month" in rupees; and any Indian team reconciling a dollar invoice against a rupee budget at month end.

## What we could not verify, and how we handled it

GST and forex treatment genuinely differ between AWS Inc and AISPL accounts, and card markup varies by issuer. We did not hard-code those assumptions. Entity, markup percentage and GST percentage are **user settings with defaults**, every derived figure is labelled an estimate, and every screen shows the inputs that produced it — the USD figure, the FX rate with its timestamp, the markup percentage and the GST percentage. A user who can see that ₹412 of their ₹4,900 is card markup has learned something they did not know. That traceability is the product, not a caveat.

## What we built

**A browser extension (Manifest V3, Edge and Chrome from one unchanged zip)** that adds a **₹ Bill button to every AWS console page**. Clicking it opens a panel showing:

- what you owe so far this month, in rupees;
- the expected month-end bill, with GST and card markup named in the sentence;
- the full conversion, line by line: `USD × FX rate → + card markup → + GST → total`;
- the top services, each in rupees;
- a button to email yourself the same summary.

It also injects a small **₹ figure beside the console's own dollar figures** on billing pages, so the rupee number sits next to Amazon's number on the same screen.

**A backend on AWS** that the extension talks to, and **a Next.js dashboard** on the same API for people who want a full-page view.

The panel is styled with the AWS console's own design tokens and **follows the console's light/dark theme live**, so it reads as part of the page rather than a bolt-on.

### What we deliberately left out

| Left out | Why |
|---|---|
| AWS Organizations, multi-account rollup | One account per user is the demo; the cross-account pattern is already proven by the read-only role |
| Per-tag, per-team cost allocation | Total plus top five services answers the question people actually ask |
| Month-on-month trend charts | The current month and its projection are what change behaviour |
| Slack/WhatsApp alerts, auto-remediation | Email via SNS covers the "tell me before it hurts" case with one service |
| Cognito | A per-user token issued after an emailed code is enough, and the SNS subscription confirmation already proves the inbox. Said plainly: this is the piece we would replace first for real users |

## Where AWS fits, service by service

| Service | Job | Why this one |
|---|---|---|
| **API Gateway (HTTP API)** | The public endpoint the extension and dashboard call | HTTP API, not REST — cheaper and sufficient; we need no REST-only features. Throttled to 5 rps so a public URL cannot be used to run up usage |
| **Lambda (Python 3.12)** | All compute: API routes and both scheduled jobs | Traffic is bursty and tiny. Nothing runs when nobody opens the panel |
| **DynamoDB** | Users, cached spend, FX rate | On-demand billing, single-digit-ms reads, no idle cost. The cache here is not optional — see below |
| **Cost Explorer** | The spend data | The accurate source: per-day granularity, gross usage before credits |
| **CloudWatch (`AWS/Billing`)** | Fallback spend source | Free, and available to accounts that cannot use Cost Explorer — including the one we were given |
| **STS** | `AssumeRole` into the user's account | The only correct way to read another account's billing without holding their keys |
| **SNS** | Sign-in codes, summaries, threshold alerts | One topic per user. The subscription confirmation doubles as proof the user owns the inbox, which is why we needed no separate email verification |
| **EventBridge Scheduler** | Daily FX refresh (06:00 IST), daily digest/alert check (07:00 IST) | Cron without a server |
| **CloudFormation** | The one-click read-only role the user installs | Turns a scary IAM setup into one button |

### The architectural decision we want judged: the cache

**Cost Explorer bills per request.** A naive extension that called it every time the popup opened would charge the user money to look at what they are spending — which is absurd, and exactly the kind of thing that should be designed away rather than discovered in a bill.

So spend is cached per account in DynamoDB with a 4-hour TTL, served from cache instantly, and refreshed behind that. The "Refresh" button cannot re-query Cost Explorer more often than once every 30 minutes, so a user leaning on it cannot generate cost either. This is a **cost decision, not a performance one**, and it is visible in the code (`backend/src/spend_handler.py`) and enforced by tests that assert Cost Explorer is called exactly once across repeated reads.

### The decision the broken account forced: two spend sources

Our AWS account cannot call Cost Explorer at all. Rather than demo against a fixture and call it done, we made the spend source pluggable:

1. **Cost Explorer** — preferred; per-day granularity, gross usage before credits, excludes tax lines so our own GST maths does not double-count.
2. **CloudWatch `AWS/Billing EstimatedCharges`** — free, available to any account with billing alerts on, updated every few hours. AWS's own estimate of the month's charges.

Whichever source answered is carried through the API as `provider` and shown to the user in one sentence. **A coarse figure never poses as a precise one.** Last month's final figure still requires Cost Explorer, because `EstimatedCharges` only covers the current month — and the code says so rather than silently returning something wrong.

## Security: no AWS credentials, anywhere in the browser

An extension is client-side code that anyone can unpack and read. Putting an access key in one would be a security failure a judge should notice immediately, so:

- The extension holds **only Paisa's own session token**. There is no AWS credential in the extension, the dashboard, or any page.
- The extension never talks to AWS. It talks to our API, which assumes a **read-only role inside the user's own account** via STS.
- That role grants three read actions — `ce:GetCostAndUsage`, `ce:GetCostForecast`, `ce:GetDimensionValues` (plus two CloudWatch read actions for the fallback). Billing figures only: no resources, no data, no writes.
- The trust policy carries a **per-user `ExternalId`**, which is what stops another AWS customer from tricking Paisa into reading someone else's account (the confused-deputy problem).
- The user revokes access by deleting one CloudFormation stack.
- The session token is held by the extension's service worker and is never written into page-side state — there is a test that asserts exactly that.

## How it is tested

Three layers, all runnable by anyone who clones the repo, none of which need an AWS account:

- **79 backend tests** (`python -m pytest backend/tests`) using `moto`, so the real DynamoDB, SNS and CloudWatch code paths execute against mocked AWS. They cover the conversion maths for both entities, the login flow including code expiry and attempt limits, the caching guarantees, the source fallback, email content, and every API route including authorisation and error handling.
- **6 browser suites, 138 checks** (`python tests/e2e/run.py`) that load the **real unpacked extension** into headless Edge and drive it over the DevTools protocol against fixture pages that stand in for the console.
- **Lint, typecheck and production build** for the Next.js dashboard.

The conversion logic exists twice — `backend/src/convert.py` and `web/lib/convert.ts` — so the dashboard can recompute instantly when a user drags the GST slider. We verified the two produce identical output to the last decimal rather than assuming.

## What we learned

Honest notes, including the things that cost us time:

- **A free-plan AWS account is not necessarily a usable one.** Ours never finished signup, so every deployable service returned `OptInRequired`. We lost real time treating that as a credentials problem before writing `scripts/check_aws.py`, which tells apart missing credentials, an expired `aws login` session, an unactivated account, and a ready one. That script is now the first thing we run.
- **Cost Explorer is opt-in and billed per request.** Both facts shaped the architecture: the first forced a second spend source, the second forced the cache.
- **Test the rendered result, not the source.** `font: 700 14px/1 inherit` looks fine and is invalid CSS — the shorthand has no `inherit` family form — so Chrome dropped the whole declaration and the panel silently rendered in Arial. Asserting on `getComputedStyle` caught what reading the code never would.
- **A stale test fixture is worse than no test.** Our badge suite was passing against an out-of-date copy of the extension. Rebuilding it from source on every run immediately exposed a real bug: the content script only matched `/billing*`, so figures on other console paths and inside sub-frames never got it.
- **Match the host application's conventions.** The panel began as a dark drawer on a console that is light by default. Adopting the console's own tokens and following its theme changed how finished it feels far more than any feature did.

> **To the team:** replace this section with what each of you personally learned. The points above are what the work itself surfaced; the judges asked what *each of you* did not know on Thursday, and that has to be in your own words.

## AI tools used

- **Claude Code (Claude Opus 5 and Sonnet 5)** — used throughout: architecture, all application code, tests, and these docs, working from a written brief. Every AWS-facing claim in this document was checked against a command we actually ran; where we could not verify something, it is marked unverified rather than asserted.

> **To the team:** add any other AI tools any of you used, by name, and remove any of the above that does not apply to you.

## Credits

- The conversion rules (entity handling, markup, GST ordering) come from the project brief and are applied as user-adjustable settings, not as claims of fact.
- FX rates come from public endpoints: [frankfurter.dev](https://frankfurter.dev) (ECB data), falling back to [open.er-api.com](https://open.er-api.com). Mid-market rates; your bank's rate will differ.
- The cross-account read-only role follows AWS's standard third-party access pattern with an `ExternalId`, as described in the AWS IAM documentation.
- Colour and type tokens approximate the AWS Cloudscape Design System so the panel matches the console. No Cloudscape code is bundled.
- No code was copied from AWS samples.

## Running it yourself

See `README.md`. Briefly: `python -m pytest backend/tests`, `python tests/e2e/run.py`, and load `extension/` unpacked at `edge://extensions`. Without a deployed API the panel will tell you it is not connected and offer a clearly labelled sample bill.
