# Recording the three-minute video

Judges see only this. A feature that is not in the video did not happen.

There are two scripts below. **Script A** is what you can record right now. **Script B** replaces the middle of it if the AWS account finishes activating and the stack deploys in time. Pick one at the last sensible moment and do not try to blend them.

The single rule running through both: **never let the video imply something is live when it is not.** A judge who catches one overclaim will doubt everything else. Saying "this is sample data" out loud costs three seconds and buys you the benefit of the doubt everywhere else.

---

## Before you press record

- [ ] `python scripts/check_aws.py` — know which script you are recording before you start.
- [ ] Load the extension: `edge://extensions` → Developer mode → Load unpacked → `extension/`. Reload any AWS console tab afterwards, or the content scripts will not be attached.
- [ ] Sign in to the AWS console in that browser.
- [ ] Close every other tab. Hide bookmarks. Clear notifications.
- [ ] Zoom the browser to ~125% so figures are readable when the video is scaled down.
- [ ] Have these ready in separate tabs: the repo on GitHub, `docs/architecture.md`.
- [ ] Have a terminal ready in the repo root, font size up, for the test run.
- [ ] Do a silent dry run first. Three minutes is shorter than it sounds.

**Do not show:** your account ID in close-up, your email inbox beyond the one Paisa message, any access key, or the CloudFormation console while other stacks are listed.

---

## Script A — what you can record today

Total 3:00. Times are cumulative.

### 0:00–0:20 · The problem

**Shot:** the real AWS console, on Billing or Cost Explorer, with a dollar figure on screen.

> "This is the AWS console, and this is what it tells an Indian developer their bill is: forty-seven dollars. Nobody in India pays forty-seven dollars. Between this number and the money that leaves your bank sit three things — the exchange rate your bank uses on the settlement date, your card's forex markup, and eighteen percent GST. No screen in AWS shows you all three."

If your account has no spend, say so rather than hiding it: *"My account is new, so this figure is zero — I'll show the maths on a worked example in a moment."*

### 0:20–0:35 · Who it is for

**Shot:** stay on the console, or cut to the README.

> "It matters most to the people with the least slack: students on the free tier who are frightened of the bill, and two-person startups where finance asks 'what will this cost us this month' — in rupees."

### 0:35–1:20 · The product

**Shot:** the same console page. Point at the **₹ Bill** button, bottom right.

> "Paisa adds one button to every page of the AWS console. You don't have to go anywhere."

Click it. The panel slides in.

> "It's asking me to sign in, because it isn't connected to a backend yet — I'll come back to why. So this is a **sample bill**, clearly labelled, to show the shape of it."

Click **See a sample**. Then walk the breakdown slowly — this is the heart of the product:

> "Forty-seven dollars becomes four thousand nine hundred rupees. And crucially you can see *why*: the dollar figure, the exchange rate and when it was fetched, the three-and-a-half percent card markup — that's four hundred and twelve rupees most people never knew they were paying — and GST on top. Every figure shows its inputs. Nothing here is a black box, and everything is labelled an estimate, because your entity and your card decide the real number."

Then the projection:

> "And this is what the month is tracking towards, with GST already in it."

### 1:20–1:40 · It belongs there

**Shot:** switch the console to dark mode (or back), with the panel open.

> "It follows the console's own theme, uses the console's type and colours, and on billing pages it puts the rupee figure right next to Amazon's dollar figure — so the number you care about is on the same screen as the number AWS shows you."

### 1:40–2:20 · The architecture

**Shot:** `docs/architecture.md` diagram, or the README.

> "No AWS credential ever goes in the extension — an extension is code anyone can unpack. The extension talks only to our API, and our Lambda assumes a read-only role inside your account, with a per-user external ID so nobody can trick it into reading someone else's account. Five read-only billing permissions, and you revoke it by deleting one CloudFormation stack."

Then the decision you want judged:

> "The one thing I'd point at: Cost Explorer bills **per request**. An extension that called it every time you opened the popup would charge you money to look at what you're spending. So it's cached in DynamoDB for four hours and refreshed behind that, and even the refresh button can't re-query more than once every thirty minutes. That's a cost decision, not a performance one."

And the fallback:

> "Our own AWS account can't call Cost Explorer at all, so we added a second source — the free CloudWatch billing metrics — and the app tells you which one answered, so a rough figure never pretends to be a precise one."

### 2:20–2:45 · It is actually tested

**Shot:** the terminal. Run these and let them finish on camera:

```bash
python -m pytest backend/tests -q
python tests/e2e/run.py
```

> "101 backend tests against mocked AWS, and 156 checks that load the real extension into a real browser and drive it. Including the ones that matter: that Cost Explorer is called exactly once across repeated reads, and that the session token never reaches the page."

**Check these numbers against what the run actually prints before you say them.** They go up most times anyone touches the repo, and a figure that contradicts the terminal on screen is the easiest kind of mistake to avoid. `python scripts/check_docs.py` verifies them.

### 2:45–3:00 · What is not done, and the links

**Shot:** the repo.

> "Being straight with you: the backend is written, tested and validated, but it is **not deployed**. The AWS account we were given never finished signup — every deployable service returns OptInRequired. That's in the writeup, along with what each of us learned. Repo's here, it runs from a clone."

---

## Script B — if the stack deploys in time

Keep 0:00–0:35 and 1:40–3:00 from Script A. Replace the middle with the real thing, and change the closing line to state the live API URL instead of the not-deployed paragraph.

### 0:35–1:05 · Onboarding, for real

> "One button on the console. Sign in with an email — there's no password, and it never asks for AWS keys."

Type the email, click through the code, and say while it sends:

> "The code goes to the inbox, which is also how we know the address is yours."

Then, on the connect step:

> "It needs read-only access to my cost data. This link opens CloudFormation in the account I'm already signed in to, with the template and my private connect ID filled in."

Click it, create the stack, come back, paste the ARN, connect.

> "Five read-only billing permissions. Delete the stack and it's gone."

### 1:05–1:35 · The real bill

> "And that's my actual account: what I owe so far in rupees, the expected bill at month end with GST in it, and the whole conversion in the open."

Click **Email me this summary**, then show the email arriving:

> "Same numbers in my inbox, and it goes out on its own on the first and the fifteenth."

**Only say this if you genuinely watched it arrive during the take.** If it does not arrive, cut the email beat rather than talking over an empty inbox.

---

## Rehearsing without AWS

`python tests/e2e/run.py` builds a throwaway copy of the extension pointed at local fixture pages and a stand-in API, and drives the whole flow. Watching those suites run is the fastest way to see every screen you are about to record.

Screenshots land in `tests/e2e/.work/screenshots/` and are useful for the README, but **do not narrate them as a live account**.

---

## After recording

- [ ] Watch it once at full length without touching anything.
- [ ] Check every claim you made out loud is true. If one is not, re-record that beat.
- [ ] Upload unlisted, then **open the link in a signed-out browser** before pasting it anywhere.
- [ ] **Publish the repo.** It has no remote yet, so this has not happened:
      ```bash
      gh auth login
      gh repo create paisa --public --source . --remote origin --push
      ```
      Then check CI goes green on GitHub (`.github/workflows/ci.yml` runs all four layers).
- [ ] Submission checklist: repo public, commit history inside the event dates, each teammate registered individually, team leader's Builder Center profile verified.
- [ ] `WRITEUP.md` has two sections marked for you — what each of you learned, and which AI tools each of you used. Fill them in before submitting; they are explicitly asked for.
