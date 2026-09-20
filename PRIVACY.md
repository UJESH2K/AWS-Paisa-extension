# Paisa — privacy policy

_Last updated: 20 September 2026._

Paisa shows you what your AWS bill costs in rupees. This describes exactly what it holds, why, and how to get rid of it. It describes the software in this repository; if you are running your own deployment, you are the data controller for it.

> **Contact:** _<add the address you want privacy questions sent to before publishing this>_

## The short version

- Paisa never asks for, receives, or stores your AWS access keys.
- It reads **billing figures only** from your AWS account, through a read-only role you create and can delete.
- The only personal data it holds is **your email address**, because that is how you sign in and how summaries reach you.
- No analytics, no advertising, no trackers, no third-party sharing, and nothing is sold.
- You can delete everything from the extension's popup, in two clicks.

## What the extension stores in your browser

Held locally via `chrome.storage.local`, never transmitted anywhere except as described below:

| What | Why |
|---|---|
| Your session token | So you stay signed in. Held by the extension's service worker and never written into any web page |
| Your assumptions (AWS entity, card markup %, GST %) | To convert figures, and to keep the page badges consistent with your bill |
| The last USD→INR rate and its timestamp | So the extension does not refetch a rate on every page |
| Readings taken from AWS console pages you visit (dollar amount, timestamp) | To show how your spend has changed. Only from AWS billing pages |
| The last bill total | So the button can show a figure before the server responds |

## What the Paisa server stores

| What | Why | How long |
|---|---|---|
| Your email address | Sign-in, and sending your summaries | Until you delete your account |
| A random per-user connect ID (`ExternalId`) | So only Paisa, acting for you, can assume your role | Until you delete your account |
| The ARN of the read-only role you connected | To read your cost data | Until you disconnect or delete your account |
| Your assumptions and alert preferences | To compute your bill and decide when to email you | Until you delete your account |
| Session tokens | To keep you signed in. Stored only as SHA-256 hashes | 30 days, then automatically removed |
| Sign-in codes | To verify it is you. Stored only as hashes | 10 minutes |
| Cached cost data: month-to-date totals and per-service USD amounts | Because the AWS Cost Explorer API is billed per request, so caching it stops Paisa costing you money to look at your own spend | A few hours, then automatically removed |

Your email address is not used as a database key; lookups go through a hash of it. The address itself is stored in your user record, because sending you a summary requires it.

## What Paisa reads from your AWS account

Only through the read-only role you install, and only these actions:

```
ce:GetCostAndUsage           ce:GetCostForecast        ce:GetDimensionValues
cloudwatch:GetMetricStatistics                         cloudwatch:ListMetrics
```

That is billing figures and nothing else: no resources, no logs, no data, and no ability to change anything. Paisa assumes that role for at most 15 minutes at a time, and only when you ask it for your bill or when a scheduled summary runs.

## Who else sees anything

- **Amazon Web Services**, as the infrastructure Paisa runs on, and as your own cloud provider.
- **The exchange-rate sources**, [frankfurter.dev](https://frankfurter.dev) and [open.er-api.com](https://open.er-api.com). These are called for a single public number — the USD→INR rate — and carry no personal data. Like any web request, they see the requesting IP address.

That is the complete list. Paisa has no analytics, no error-reporting service, no advertising, and no third-party scripts.

## Children

Paisa is a tool for people who operate AWS accounts and is not directed at children.

## Deleting your data

- **Everything Paisa holds:** open the extension's popup, then **Your Paisa account → Delete my data → Yes, delete everything**. This removes your email address, settings, sessions and cached spend, and deletes the notification topic used to email you. It cannot be undone.
- **Paisa's access to your AWS account:** delete the `PaisaReadOnly` CloudFormation stack in your own AWS console. Paisa cannot delete that for you — it is a resource in your account, not ours — and deleting your Paisa data does not remove it.
- **Local data:** removing the extension clears everything it stored in your browser.

## Changes

If this policy changes materially, the version published with the extension listing is the one that applies to the release you have installed.
