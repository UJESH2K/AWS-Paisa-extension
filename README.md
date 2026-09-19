# Paisa

See what your AWS bill actually costs in rupees, after forex, card markup and GST, before the invoice lands.

> Work in progress for the WeMakeDevs "First Commit" hackathon (Ship It track). Every rupee figure Paisa shows is an **estimate**: GST, forex and card-markup treatment depend on your AWS entity and card issuer, so they are user settings, not hard-coded assumptions.

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

## Status

- [x] Conversion logic + tests (`backend/`)
- [x] Dashboard and onboarding UI (`web/`), running on labelled sample data until the API is deployed
- [ ] AWS backend (SAM) and Cost Explorer caching
- [ ] Read-only role template
- [ ] Console badge extension

## Run the dashboard

```
cd web
cp .env.example .env.local   # leave NEXT_PUBLIC_API_URL empty for the sample-data preview
npm install
npm run dev
```

## Test the conversion maths

```
python -m pytest backend/tests
```

`web/lib/convert.ts` is a TypeScript port of `backend/src/convert.py` so the dashboard can recompute instantly when settings change; the Python module is the source of truth.

## API contract (dashboard to backend)

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/register` | none | `{ token, externalId }` |
| POST | `/connect` | `{ roleArn }` (Bearer token) | `{ ok: true }` after a test AssumeRole and a 1-day Cost Explorer call |
| GET | `/spend` | Bearer token | see `web/lib/types.ts` `SpendResponse` |
| PUT | `/settings` | `{ entity, markup_pct, gst_pct }` | `{ ok: true }` |
