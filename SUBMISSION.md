# Start here

Everything that could be built and verified without you has been. What remains needs your hands, your accounts, or your voice. This is the order to do it in.

**Deadline: Sunday 20:00 IST.**

---

## Where things actually stand

| | State |
|---|---|
| Extension (button, panel, badges, popup) | Built. `dist/paisa-extension-0.9.0.zip` |
| Backend (API, auth, spend, emails, schedules) | Written, tested, template validates. **Not deployed** |
| Dashboard (`web/`) | Built and tested. **Not deployed** |
| Tests | 101 backend (98% coverage), 155 browser checks across 6 suites. All green locally |
| CI | Written. **Never run** — the repo has no remote yet |
| Repo | 21 commits, dated inside the event window. **Not published** |
| Video | **Not recorded** |

Nothing above claims a running deployment, and neither should you.

---

## Do these in order

### 1. Renew AWS access — 2 minutes, unblocks everything else

```bash
aws login
python scripts/check_aws.py
```

The check prints one of four things. What it says decides your next hour:

- **`READY`** → go to step 2, then record **Script B**.
- **`NOT_ACTIVATED`** → the account never finished signup. Add a payment method and complete phone verification at Billing → Payment preferences. If that clears quickly, come back to step 2; if not, skip to step 3 and record **Script A**.
- **`EXPIRED`** → `aws login` did not take. Try again.
- **`NO_CREDENTIALS`** → the CLI is not configured at all.

### 2. Deploy, only if step 1 said READY — about 15 minutes

```bash
cd backend
sam build && sam deploy --guided --parameter-overrides OwnerEmails=<your-email>
```

Everything it creates is pay-per-use and idle-free. The only metered items are Cost Explorer (billed per request, which is why spend is cached for four hours) and SNS email (1,000/month free).

Then wire the live URL in and rebuild:

```bash
# extension/config.js  -> apiUrl: "https://<id>.execute-api.ap-south-1.amazonaws.com"
# web/.env.local       -> NEXT_PUBLIC_API_URL=<same URL>
python scripts/package_extension.py
python tests/e2e/run.py --from-zip     # prove the packaged build still works
```

If Cost Explorer is not enabled on the account, Paisa falls back to CloudWatch billing metrics on its own and says which source answered. You do not need to do anything for that.

### 3. Record the video — about 45 minutes including a dry run

`docs/demo.md` has the full script, beat by beat, with the lines to say.

- **Script A** needs no AWS. Record this if step 1 did not reach READY.
- **Script B** replaces the middle if you deployed.

Load the extension first: `edge://extensions` → Developer mode → Load unpacked → `extension/`, then **reload your AWS console tab**, or the content scripts will not attach.

Check the test counts against what the terminal actually prints before saying them out loud. They have changed several times.

### 4. Publish the repo — 5 minutes

```bash
gh auth login
gh repo create paisa --public --source . --remote origin --push
```

Then watch CI go green on GitHub. It has never run, so treat the first run as a real check rather than a formality. If a job fails, the failure is information, not something to hide — but do not put a broken badge in the submission.

### 5. Fill in what only you can write — 15 minutes

- **`WRITEUP.md`** has two sections marked for you: what **each of you** learned, and which AI tools **each of you** used. The judges asked for both explicitly. I have left the points the work itself surfaced; your own words go on top.
- **`PRIVACY.md`** needs a contact address at the top. Both extension stores require a reachable one.

### 6. Submit

Confirm before you do:

- [ ] Repo public, commit history inside the event dates
- [ ] Video uploaded unlisted, and **opened in a signed-out browser** to check it plays
- [ ] Each teammate registered individually on wemakedevs.org
- [ ] Team leader's Builder Center profile verified
- [ ] Every claim in the video is true of what a judge would see

### Optional, and not before the deadline

Store submission (`docs/store-listing.md`). Review takes days, so this cannot be a dependency — describe the listing as submitted and in review, and verify the current fees yourself rather than trusting any document here.

---

## If you are short on time

Do 1, 3 (Script A), 4, 5, 6. The deployment is the only thing Script A gives up, and being straightforward about why is better than a rushed deploy that breaks on camera.

---

## How to check any of this yourself

```bash
python -m pytest backend/tests -q --cov=backend/src   # 101 tests, 98% coverage
python tests/e2e/run.py                               # 6 browser suites (155 checks)
python tests/e2e/run.py --from-zip                    # the same, against the shipped zip
python scripts/check_aws.py                           # can this machine deploy?
```
