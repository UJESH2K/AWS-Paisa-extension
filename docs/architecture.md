# Architecture

> Not deployed yet: the target AWS account has not finished signup. This describes
> what the SAM template creates and what the code does, all of which is exercised
> by tests against mocked AWS. See `WRITEUP.md` for the full status.

## The shape of it

```
  ┌──────────────────────────────┐      ┌──────────────────────────────┐
  │  Browser extension (MV3)     │      │  Next.js dashboard (Vercel)  │
  │  on console.aws.amazon.com   │      │  web/                        │
  │                              │      │                              │
  │  panel.js   ₹ Bill button    │      │  full-page view of the same  │
  │             + slide-in panel │      │  bill, same API              │
  │  content.js ₹ beside AWS's   │      │                              │
  │             own $ figures    │      │                              │
  │  background.js  session +    │      │                              │
  │             FX cache         │      │                              │
  └──────────────┬───────────────┘      └──────────────┬───────────────┘
                 │                                     │
                 │   HTTPS + Paisa session token       │
                 │   (never an AWS credential)         │
                 └──────────────┬──────────────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │  API Gateway (HTTP API)      │  throttled 5 rps
                 │  /auth/start  /auth/verify   │
                 │  /me  /spend  /settings      │
                 │  /connect  /email-summary    │
                 └──────────────┬───────────────┘
                                ▼
                 ┌──────────────────────────────┐
                 │  Lambda  paisa-api           │  Python 3.12
                 │  api.py routes to:           │
                 │   auth_handler  spend_handler│
                 │   settings_handler  email_   │
                 │   handler  alert_checker     │
                 │   fx_refresher               │
                 └───┬───────┬──────────┬───────┘
                     │       │          │
        ┌────────────▼──┐ ┌──▼───┐  ┌───▼─────────────────────────┐
        │ DynamoDB      │ │ SNS  │  │  The user's own AWS account │
        │  PaisaUsers   │ │ per- │  │                             │
        │  PaisaCache   │ │ user │  │  IAM role PaisaReadOnlyRole │
        │  PaisaFx      │ │ topic│  │   ce:GetCostAndUsage        │
        └───────────────┘ └──────┘  │   ce:GetCostForecast        │
                                    │   ce:GetDimensionValues     │
                     ▲              │   cloudwatch:GetMetric*     │
                     │              │  trust: our account +       │
        ┌────────────┴───────────┐  │         per-user ExternalId │
        │ EventBridge Scheduler  │  └─────────────────────────────┘
        │  06:00 IST  FX refresh │         ▲ assumed via STS
        │  07:00 IST  digest     │         │ (short-lived, 15 min)
        └────────────────────────┘─────────┘
```

## Request flows

### Signing in (no passwords, no Cognito)

```
POST /auth/start {email}
  first time  → create user + SNS topic, subscribe the address
              → AWS sends "Confirm subscription"; reply "confirm_subscription"
  thereafter  → if the subscription is confirmed, publish a 6-digit code
              → reply "code_sent"
POST /auth/verify {email, code}
  → constant-time compare, single use, 10-minute expiry, 5 attempts
  → returns an opaque 32-byte token (stored hashed, 30-day TTL)
```

The SNS subscription confirmation is what proves the user owns the inbox, so no separate email-verification step exists. `/auth/start` is rate-limited to one call per minute per address by a conditional DynamoDB write, so the endpoint cannot be used to spam someone's inbox.

### Reading spend (the cache is the point)

```
GET /spend
  → authenticate token
  → which account?  connected role  → STS AssumeRole with the user's ExternalId
                    stack owner     → this account's own costs
  → cache hit (< 4 h, and ≥ 30 min old if ?refresh=1)  → serve it
  → cache miss:
        try   Cost Explorer  GetCostAndUsage, month-to-date, GroupBy SERVICE
        on Unavailable (account cannot use Cost Explorer)
        then  CloudWatch  AWS/Billing EstimatedCharges (us-east-1)
  → convert() with the user's entity / markup / GST
  → write to PaisaCache with TTL, return
```

**Cost Explorer is billed per request.** Everything above exists so that opening the panel does not cost the user money. Tests assert that repeated reads call it exactly once, that a forced refresh inside 30 minutes does not reach it, and that a month rollover does not serve last month's cache.

### The daily job

One Lambda, invoked by EventBridge Scheduler with `{"task": "fx"}` or `{"task": "digest"}`:

- **06:00 IST** — fetch USD→INR from a public endpoint and store it with a timestamp. If every source fails, keep the last good rate; readers never block on the network.
- **07:00 IST** — for each user: if the projection crosses their rupee threshold, email once per month; on the 1st email last month's final estimate; on the 15th email the current projection. One user's failure is logged and does not stop the rest.

## Data model

Single-table-ish, one partition key `pk`, no indexes needed.

| Table | Item | Notes |
|---|---|---|
| `PaisaUsers` | `user#<uuid>` | email, SNS topic ARN, ExternalId, roleArn, settings |
| | `email#<sha256>` | email → userId, so the address itself is not a key |
| | `tok#<sha256>` | session token (hashed), TTL 30 days |
| | `code#<userId>` | sign-in code hash, expiry, attempt count |
| | `thr#<sha256>` | rate-limit marker, TTL 60s |
| `PaisaCache` | `spend#<account>#<YYYY-MM>` | the raw spend JSON, `fetchedAt`, TTL |
| `PaisaFx` | `USDINR` | rate, source, `fetchedAt` |

Session tokens and sign-in codes are stored only as SHA-256 hashes, and the email address is never used as a
key (lookups go through `email#<sha256>`). The user record itself holds the address in plain text, because
sending the summary requires it. All tables are on-demand, so an idle stack costs nothing.

## Security model

- **No AWS credential ever reaches the browser.** The extension holds only a Paisa session token; a test asserts the token never appears in page-side state.
- **Cross-account reads use STS with a per-user `ExternalId`**, which prevents the confused-deputy problem. The role's trust policy names our account and requires that ExternalId.
- **Least privilege:** the installed role grants five read-only billing actions and nothing else. The Lambda's own policy scopes SNS to `paisa-*` topics and `sts:AssumeRole` to roles named `PaisaReadOnlyRole`.
- **Revocation is one action:** delete the CloudFormation stack.
- **The public API is throttled** (5 rps, burst 10) so the URL cannot be used to run up Cost Explorer charges or send email.
- Server errors are logged but never returned verbatim; a test asserts internals do not leak into responses.

## What costs money, and what does not

| | Cost |
|---|---|
| Lambda, API Gateway, DynamoDB on-demand, EventBridge, CloudWatch Logs (7-day) | Effectively zero at this scale; nothing runs when idle |
| SNS email | First 1,000 emails/month free |
| **Cost Explorer API** | **Billed per request** — the reason the cache exists |
| CloudWatch `AWS/Billing` metrics | Free |

Verify the current Cost Explorer per-request price on the AWS pricing page before quoting a figure.

## Failure modes, and what the user sees

| If | Then |
|---|---|
| FX sources are down | Last good rate is served with its timestamp; never blocks |
| Cost Explorer is not enabled | Falls back to CloudWatch billing metrics, and says which source answered |
| Neither source is available | A specific message naming both fixes (enable Cost Explorer, or turn on billing alerts) |
| The console's DOM changes | The badge fails silently; the panel is independent of the console's markup |
| The console removes our node | A MutationObserver re-attaches it |
| No API is configured | The panel says so and offers a clearly labelled sample — it never shows invented figures as real |

## Repository layout

```
backend/     SAM template + Python: api, auth, spend, settings, email, schedules
  src/convert.py      the pure conversion maths, unit-tested
  src/ce.py, cw.py    the two spend sources
extension/   MV3: panel.js (button + panel), content.js (inline badges),
             background.js (session + FX), popup.js
web/         Next.js dashboard (App Router, Tailwind)
onboarding/  the CloudFormation role the user installs
tests/e2e/   browser suites driving the real extension
scripts/     check_aws.py, package_extension.py, make_icons.py
```
