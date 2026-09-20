# Paisa

See what your AWS bill actually costs in rupees, after forex, card markup and GST, before the invoice lands.

> **If you are picking this up to finish the submission, read [SUBMISSION.md](SUBMISSION.md) first** — it lists what is done, what is not, and the order to do the rest in.
>
> Work in progress for the WeMakeDevs "First Commit" hackathon (Ship It track). Every rupee figure Paisa shows is an **estimate**: GST, forex and card-markup treatment depend on your AWS entity and card issuer, so they are user settings, not hard-coded assumptions.

## Try it in two minutes

No account, no sign-up, no backend. It reads the figure already on your own AWS billing page.

1. Download `dist/paisa-extension-0.9.1.zip` and unzip it anywhere.
2. Open `edge://extensions` (or `chrome://extensions`), turn on **Developer mode**,
   click **Load unpacked**, and pick the unzipped folder.
3. Open your **AWS Billing and Cost Management** console — and reload the tab if it
   was already open.
4. Click the **₹ Bill** button at the bottom right.

You will see your own month-to-date figure in rupees, the expected month-end bill with
GST, and the whole conversion line by line. Nothing is sent anywhere: the conversion
happens in your browser, and the only network call is for the public USD→INR rate.

Edge reports the extension as requiring **no special permissions** — it can act only on
`console.aws.amazon.com` and two exchange-rate APIs.

If your account has no spend yet (a new or free-plan account), there is no figure to
read and Paisa will say so rather than invent one.

## Architecture

```
  Next.js dashboard (Vercel)          Browser extension (MV3, thin)
  web/  - breakdown, settings,        extension/ - injects the rupee
          onboarding                                figure into the AWS
        \                                           billing console
         \_________ HTTPS + per-user token _________/
                          |
                 API Gateway (HTTP API)
                          |
                       Lambda (Python 3.12)
        /register  /connect  /spend  /settings  + scheduled FX refresh
             |          |        |
         DynamoDB      STS    Cost Explorer
       users/cache/fx  AssumeRole  (cache-first: it bills per request)
                          |
                 user's AWS account: read-only IAM role
                 (created by CloudFormation quick-create, ExternalId in trust policy)
```

No AWS credentials ever live in the browser, the dashboard or the extension. The backend assumes a read-only role in the user's own account.

## Repository

| Path | What |
|---|---|
| `backend/` | AWS SAM stack: Lambdas, DynamoDB, API. `src/convert.py` holds the pure, unit-tested conversion maths |
| `web/` | Next.js (App Router, Tailwind) dashboard, deployable on Vercel |
| `extension/` | Manifest V3 extension for Edge and Chrome (console badge) |
| `onboarding/` | CloudFormation template the user installs to grant read-only cost access |
| `docs/` | `architecture.md` (how it fits together), `demo.md` (the recording plan), `store-listing.md` (publishing it) |

## Status

- [x] Conversion logic + tests (`backend/`)
- [x] Dashboard and onboarding UI (`web/`)
- [x] AWS backend (SAM): email sign-in, cached spend, email summaries, scheduled digest
- [x] Spend source fallback: CloudWatch billing metrics when Cost Explorer is unavailable
- [x] Read-only role template (`onboarding/`)
- [x] ₹ Bill button and panel on every AWS console page, themed to match the console
- [x] Inline ₹ badges beside the console's own dollar figures
- [ ] **Not yet deployed.** The target AWS account has not finished signup, so no
      stack exists yet; `extension/config.js` has no API URL and the panel
      offers a labelled sample instead of claiming to show real data.

## Run the dashboard

```
cd web
cp .env.example .env.local   # leave NEXT_PUBLIC_API_URL empty for the sample-data preview
npm install
npm run dev
```

## Tests

```
python -m pytest backend/tests     # 101 tests: conversion maths, auth, caching,
                                   # spend sources, emails, API routes (moto, no AWS)
python tests/e2e/run.py            # 6 browser suites (156 checks): the extension and the dashboard
cd web && npm run lint && npm run build
```

The backend tests use `moto`, so they exercise the real DynamoDB/SNS/CloudWatch
code paths without touching an AWS account: `pip install -r backend/requirements-dev.txt`.
They cover 98% of `backend/src`, and CI fails below 95%. Add `--cov=backend/src
--cov-report=term-missing` to see the gaps.
The browser suites need Node and Edge or Chrome; see `tests/e2e/README.md`.

`python scripts/check_docs.py` checks that the figures in these docs match the
repo — test counts and versions drift, and `docs/demo.md` tells someone what to
say on camera.

`python scripts/check_aws.py` reports whether this machine can deploy at all,
telling apart missing credentials, an expired `aws login` session, an account
that has not finished signup, and a ready account.

`web/lib/convert.ts` is a TypeScript port of `backend/src/convert.py` so the dashboard can recompute instantly when settings change; the Python module is the source of truth.

## API contract (dashboard to backend)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/register` | none | `{ token, externalId }` |
| POST | `/connect` | `{ roleArn }` (Bearer token) | `{ ok: true }` after a test AssumeRole and a 1-day Cost Explorer call |
| GET | `/spend` | Bearer token | see `web/lib/types.ts` `SpendResponse` |
| PUT | `/settings` | `{ entity, markup_pct, gst_pct }` | `{ ok: true }` |
| POST | `/account/delete` | Bearer token | erases everything Paisa holds about the user |

## Extension (Edge and Chrome)

`extension/` is a Manifest V3 extension with no build step. In its standalone mode it needs no AWS access: it reads the dollar figure on the AWS Billing / Cost Management page, fetches a public USD to INR rate (frankfurter.dev, falling back to open.er-api.com), and shows the rupee estimate beside it. The popup tracks how the cost changes between readings and splits the change into "you spent more" and "the exchange rate moved".

Build the store zip: `python scripts/package_extension.py` (writes `dist/paisa-extension-<version>.zip`).
Load unpacked: `edge://extensions` (or `chrome://extensions`) > Developer mode > Load unpacked > pick `extension/`.

The console DOM is not ours, so the badge finds amounts heuristically and fails silently; the popup calculator works anywhere.
