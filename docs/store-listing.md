# Submitting to the Edge Add-ons and Chrome Web Stores

One codebase, one zip, both stores — the manifest needs nothing different. Build it with:

```bash
python scripts/package_extension.py     # writes dist/paisa-extension-<version>.zip
```

> **Do not make store approval a dependency of your hackathon submission.** Review takes days. Film the extension running unpacked, and describe the listing as submitted and in review.
>
> **Verify the fees and policies yourself before saying anything about them on camera.** Store terms change. At the time of writing, Edge Add-ons had no developer registration fee and the Chrome Web Store charged a one-time registration fee, but check both dashboards rather than trusting this sentence.

## Before you submit

- [ ] A **privacy policy at a public URL**. Both stores require one because Paisa handles an email address. `PRIVACY.md` is written for this — publish it (GitHub renders it at a stable URL) and fill in the contact address at the top first.
- [ ] Decide what the listing says about the backend. If the API is not deployed, say in the description that the extension works standalone and that connecting an AWS account requires the hosted service. Do not describe a service that is not running.
- [ ] Screenshots. `python tests/e2e/run.py` writes usable ones to `tests/e2e/.work/screenshots/`. Both stores want 1280×800 or 640×400.

## Listing copy

**Name:** `Paisa — AWS bill in rupees`

**Short description** (132 characters max):

> See what your AWS bill really costs in rupees, after forex, card markup and GST — before the invoice lands.

**Long description:**

> The AWS console shows you dollars. Your bank charges you rupees, at its own exchange rate, plus your card's foreign-currency markup, plus 18% GST. Nowhere does AWS show you all three together — so the number on screen is not the number that leaves your account.
>
> Paisa adds a ₹ Bill button to every page of the AWS console. One click shows:
>
> • what you owe so far this month, in rupees
> • the expected month-end bill, with GST included
> • the full conversion, line by line: dollars → exchange rate → card markup → GST
> • which services are costing you the most, in rupees
>
> On billing pages it also puts the rupee figure right next to Amazon's own dollar figure, so both numbers are on the same screen.
>
> Paisa never asks for your AWS access keys. To read your costs it uses a read-only role you create yourself with one click, granting five billing-read permissions and nothing else. Delete the CloudFormation stack and access is gone.
>
> Every figure is labelled an estimate and shows the inputs that produced it — the dollar amount, the exchange rate and when it was fetched, your card's markup percentage and your GST rate. Your AWS entity and your card issuer decide the real number, so those are settings you control, not assumptions we hide.
>
> Open source: <your repo URL>

**Category:** Developer tools
**Search terms:** aws, cloud cost, billing, rupees, inr, gst, forex, finops
**Language:** English (India)

## Permission justifications

Reviewers ask why each permission is needed. These are the true answers:

| Permission | Justification |
|---|---|
| `storage` | Stores the user's own settings (AWS entity, card markup, GST rate), the cached exchange rate, and the sign-in session token. No browsing data. |
| `https://console.aws.amazon.com/*`, `https://*.console.aws.amazon.com/*` | The extension's entire purpose is to add a rupee figure to the AWS console. It reads dollar amounts already visible on the user's own billing pages and injects the converted figure beside them. It does not read any other site. |
| `https://api.frankfurter.dev/*`, `https://open.er-api.com/*` | Fetches the public USD→INR exchange rate. No user data is sent; the request carries only the currency pair. |
| Host permission for the Paisa API (added when configured) | The extension's own backend, which holds the user's account and returns their bill. |

**Remote code:** none. All scripts are bundled in the package; nothing is fetched and executed at runtime.

**Data handling declaration:** personally identifiable information — email address only, used for authentication and to send the user their own bill summaries. Not sold, not transferred to third parties, not used for advertising or credit purposes.

## Submitting

**Edge Add-ons** — [Partner Center](https://partner.microsoft.com/dashboard/microsoftedge) → Extensions → New extension → upload the zip → fill in the listing, the privacy policy URL, and the permission justifications → submit.

**Chrome Web Store** — [Developer Dashboard](https://chrome.google.com/webstore/devconsole) → New item → upload the **same zip** → fill in the listing, the privacy practices tab, and the permission justifications → submit.

Both will ask you to confirm the data-handling declaration. Answer it from the table above; the privacy policy has to agree with what you tick, and a mismatch is a common rejection.

## After it is live

Bump `version` in `extension/manifest.json` for each submission — stores reject a re-upload of an existing version. Keep the version in step with what the README and the video claim.
