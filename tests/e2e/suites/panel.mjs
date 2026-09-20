// The "₹ Bill" button and panel on the AWS console: sign-in, the bill itself,
// and what happens when there is no server, no session, or no connected account.
//
// Pass "noapi" as the third argument to exercise a build with no API URL.
import { Checks, PANEL_HOST, PANEL_SHADOW, inr0, launch, openPage, panelDriver, sleep, usd } from "../harness.mjs";

const [extDir, shotDir, mode] = process.argv.slice(2);
const NO_API = mode === "noapi";
const PORT = 9555;
const SITE = "http://localhost:8765";
const API = "http://127.0.0.1:8766";
const c = new Checks(NO_API ? "panel (no API configured)" : "panel");
const { proc, extensionId } = await launch({ extDir, port: PORT, profileTag: "paisa-panel" });

try {
  const ext = await openPage(PORT, `chrome-extension://${extensionId}/popup.html`);
  const storage = (key) =>
    ext.ev(`new Promise(r=>chrome.storage.local.get(${JSON.stringify(key)},d=>r(d[${JSON.stringify(key)}])))`);
  const setStorage = (obj) => ext.ev(`new Promise(r=>chrome.storage.local.set(${JSON.stringify(obj)},()=>r(true)))`);

  if (NO_API) {
    // With no server at all — which is what anyone gets the moment they install
    // the extension — the panel must still answer the question, using the
    // figure on the page in front of them.
    const billing = await openPage(PORT, `${SITE}/billing.html`);
    const bd = panelDriver(billing);
    await billing.waitFor("!!document.querySelector('.paisa-badge')", 20000);
    await sleep(1500);
    c.check("the button appears with no backend configured", await billing.waitFor(`!!${PANEL_HOST}`), true);
    await bd.open();
    await sleep(1200);
    const text = await bd.text();
    c.check("it converts the page's own figure, with no account", text.toLowerCase().includes("so far"), true);
    c.check("and says where that figure came from", text, (s) => s.includes("Converted from the") && s.includes("shown on this page"));
    c.check("it is not passed off as sample data", text, (s) => !s.includes("Sample data, not your account."));
    c.check("the full conversion is shown", text, (s) => ["Card forex markup", "GST", "Total so far (estimate)"].every((x) => s.includes(x)));
    c.check("it is explicit that nothing was sent anywhere", text, (s) => s.includes("nothing sent anywhere"));

    // On a page with no figure at all there is nothing honest to convert.
    const home = await openPage(PORT, `${SITE}/home.html`);
    const hd = panelDriver(home);
    await home.waitFor(`!!${PANEL_HOST}`);
    await hd.open();
    await sleep(1200);
    // On a page with no figure of its own, the last reading is still useful —
    // but it must not be described as being on this page.
    const awayText = await hd.text();
    c.check("away from a billing page it shows the last reading", awayText.toLowerCase().includes("so far"), true);
    c.check("and says it is the last one, with when", awayText, (s) => s.includes("Your last reading, from"));
    c.check("without claiming the figure is on this page", awayText, (s) => !s.includes("shown on this page"));

    c.check("no console errors", [...billing.errors, ...home.errors, ...ext.errors].length, 0);
    proc.kill();
    process.exit(c.summary() ? 0 : 1);
  }

  // ---- signed out, on the console home page ----
  const page = await openPage(PORT, `${SITE}/home.html`);
  const d = panelDriver(page);
  c.check("the button appears on the console home page", await page.waitFor(`!!${PANEL_HOST}`), true);
  c.check("it reads 'Bill' before sign-in", await d.fab(), (s) => s.includes("Bill"));
  await d.open();
  c.check("the drawer opens on the sign-in view", await d.has("See your AWS bill in rupees"), true);

  // ---- email sign-in: confirm the address, then a 6-digit code ----
  await d.type("email", "owner@example.com");
  await d.click("Send me a code");
  c.check("the first sign-in asks you to confirm the AWS email", await d.has("Confirm your email"), true);
  await d.click("I've confirmed");
  c.check("then it asks for the code", await d.has("Enter your code"), true);
  await d.type("code", "111111");
  await d.click("Sign in");
  c.check("a wrong code is rejected", await d.has("wrong or has expired"), true);
  await d.type("code", "123456");
  await d.click("Sign in");
  c.check("the right code shows the bill", await d.has("Expected bill this month"), true);

  // ---- the bill ----
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const total = 47.3 * 95.88 * 1.035 * 1.18;
  const projection = (total / now.getUTCDate()) * daysInMonth;
  const nextMonth = new Intl.DateTimeFormat("en-IN", { month: "long", timeZone: "UTC" }).format(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  );
  const text = await d.text();
  c.check("it shows what you owe so far, in rupees", text.includes(inr0(total)), true);
  c.check(
    "and the expected month-end bill, naming GST and markup",
    text.includes(inr0(projection)) && text.includes("Includes 18% GST and 3.5% card markup"),
    true,
  );
  c.check(
    "every step of the conversion is visible",
    ["$47.30 × ₹95.88", "Card forex markup 3.50%", "GST 18.00%", "Total so far (estimate)"].every((s) => text.includes(s)),
    true,
  );
  c.check(
    "the top services are listed",
    ["Amazon EC2", "Amazon RDS", "Amazon S3", "Amazon CloudFront", "AWS Lambda", "Everything else"].every((s) => text.includes(s)),
    true,
  );
  c.check("it says when AWS will issue the invoice", text.includes(`early ${nextMonth}`), true);
  c.check("the button now carries the figure", await d.fab(), (s) => s.includes(`≈ ${inr0(total)}`));
  c.check(
    "the session token never reaches page-side state",
    await page.ev("JSON.stringify(document.documentElement.outerHTML).includes('tok-owner')"),
    false,
  );
  c.check("the session is held by the extension", (await storage("session"))?.email, "owner@example.com");
  if (shotDir) await page.screenshot(`${shotDir}/panel-bill.png`);

  // ---- the printable report ----
  // "Save as PDF" writes the summary to storage and opens a report page. What
  // matters is that the document carries its own caveats: whoever opens the PDF
  // never saw the extension.
  c.check("the bill offers a PDF export", await d.click("Save as PDF"), true);
  // The panel writes the summary to storage, then opens the report page.
  let wroteReport = false;
  for (let i = 0; i < 20 && !wroteReport; i++) {
    wroteReport = !!(await storage("report"));
    if (!wroteReport) await sleep(300);
  }
  c.check("the summary is handed to the report page", wroteReport, true);
  const reportUrl = `chrome-extension://${extensionId}/report.html`;
  const report = await openPage(PORT, reportUrl);
  await report.waitFor("document.getElementById('soFar').textContent !== '—'", 10000);
  const doc = await report.ev("document.body.innerText");
  c.check("the report shows the same total as the panel", doc.includes(inr0(total).replace(/[^\d,₹]/g, "").slice(0, 5)), true);
  c.check("it breaks the conversion out", doc, (s) => s.includes("per USD") && s.includes("GST,"));
  c.check("it carries the estimate caveat on its own", doc, (s) => s.includes("Every figure here is an estimate"));
  c.check("it names the rate's source", doc, (s) => s.toLowerCase().includes("mid-market"));
  c.check("and states it is not an AWS product", doc, (s) => s.includes("not affiliated with Amazon Web Services"));
  if (shotDir) await report.screenshot(`${shotDir}/report.png`);


  // ---- email and refresh ----
  await d.click("Email me this summary");
  c.check("emailing the summary confirms where it went", await d.has("Sent to owner@example.com"), true);
  await d.click("Refresh");
  await sleep(500);
  const log = await (await fetch(`${API}/_log`)).json();
  c.check(
    "refresh asks the server to re-read (the server rate-limits Cost Explorer)",
    log.some(([method, path]) => method === "GET" && path === "/spend?refresh=1"),
    true,
  );

  // ---- persistence and sign-out ----
  await page.send("Page.reload");
  await sleep(1500);
  await page.waitFor(`!!${PANEL_HOST}`);
  c.check("after a reload the button still shows the last figure", await d.fab(), (s) => s.includes(`≈ ${inr0(total)}`));
  await d.open();
  c.check("and the bill loads again without signing in", await d.has("Expected bill this month"), true);
  await d.click("Sign out");
  c.check("signing out returns to the sign-in view", await d.has("See your AWS bill in rupees"), true);
  c.check("and clears the stored session", await storage("session"), (v) => v === undefined || v === null);

  // ---- an expired session, and an account that isn't connected ----
  await setStorage({ session: { token: "not-a-real-token", email: "x@example.com" } });
  await page.send("Page.reload");
  await sleep(1200);
  await page.waitFor(`!!${PANEL_HOST}`);
  await d.open();
  c.check("a stale session asks you to sign in again", await d.has("session expired"), true);

  await d.type("email", "stranger@example.com");
  await d.click("Send me a code");
  await d.has("Confirm your email");
  await d.click("I've confirmed");
  await d.has("Enter your code");
  await d.type("code", "123456");
  await d.click("Sign in");
  c.check("someone with no connected account is told to connect one", await d.has("Connect your AWS account"), true);

  // The whole role hand-off happens here, in the console the user is already
  // signed in to, rather than sending them off to a separate dashboard.
  await sleep(600);
  const connectText = await d.text();
  c.check("it shows the connect ID for the role's trust policy", connectText.includes("Connect ID ext"), true);
  c.check("it lists exactly what Paisa will be able to read", connectText.includes("ce:GetCostAndUsage"), true);
  const link = await page.ev(`(()=>{const a=${PANEL_SHADOW}.getElementById('roleLink'); return a && {href:a.href, target:a.target, rel:a.rel};})()`);
  c.check("the one-click link opens CloudFormation quick-create", link?.href, (u) => typeof u === "string" && u.includes("/stacks/quickcreate?"));
  c.check("with the template and the user's ExternalId filled in", link?.href, (u) => u.includes("templateURL=") && u.includes("param_ExternalId=ext"));
  c.check("in the configured region", link?.href, (u) => u.startsWith("https://ap-south-1.console.aws.amazon.com/cloudformation/"));
  if (shotDir) await page.screenshot(`${shotDir}/panel-connect.png`);
  c.check("and opens safely in a new tab", `${link?.target} ${link?.rel}`, (s) => s.includes("_blank") && s.includes("noopener"));

  c.check(
    "a malformed ARN leaves the connect button disabled",
    await page.ev(`(()=>{
      const i=${PANEL_SHADOW}.getElementById('arn');
      i.value='not-an-arn'; i.dispatchEvent(new Event('input',{bubbles:true}));
      return ${PANEL_SHADOW}.getElementById('connectBtn').disabled;
    })()`),
    true,
  );
  await d.type("arn", "arn:aws:iam::123456789012:role/PaisaBrokenRole");
  await d.click("Verify and connect");
  c.check("a role Paisa cannot assume reports why", await d.has("couldn't assume that role"), true);

  await d.type("arn", "arn:aws:iam::123456789012:role/PaisaReadOnlyRole");
  await d.click("Verify and connect");
  c.check("connecting a working role shows the bill", await d.has("Expected bill this month"), true);

  await d.click("Sign out");
  await d.has("See your AWS bill in rupees");
  await d.click("See a sample");
  await sleep(300);
  const sample = await d.text();
  c.check(
    "the sample never poses as real data",
    sample.includes("Sample data, not your account.") && sample.includes("Sign in for my real bill"),
    true,
  );

  // ---- a brand-new account with no spend at all ----
  // The likeliest first experience: free tier, nothing billed yet. Zero has to
  // read as "nothing yet", not as a broken panel.
  await setStorage({ session: { token: "tok-owner@example.com", email: "owner@example.com" } });
  await fetch(`${API}/_zero`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: true }) });
  const empty = await openPage(PORT, `${SITE}/home.html`);
  const ed = panelDriver(empty);
  await empty.waitFor(`!!${PANEL_HOST}`);
  await ed.open();
  c.check("an account with no spend still loads", await ed.has("So far", 12000), true);
  const zeroText = await ed.text();
  c.check("it shows zero rupees rather than an error", zeroText, (s) => s.includes(inr0(0)));
  c.check("and explains why zero is plausible", zeroText, (s) => s.includes("No charges so far this month"));
  c.check("it does not invent a projection", zeroText, (s) => !/₹[1-9]/.test(s.split("Where it comes from")[0] ?? s));
  await fetch(`${API}/_zero`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: false }) });

  // ---- a server that accepts the connection and never answers ----
  await setStorage({ session: { token: "tok-owner@example.com", email: "owner@example.com" } });
  await fetch(`${API}/_hang`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: true }) });
  const stuck = await openPage(PORT, `${SITE}/home.html`);
  const sd = panelDriver(stuck);
  await stuck.waitFor(`!!${PANEL_HOST}`);
  await sd.open();
  c.check("a hung server produces an error, not an endless spinner", await sd.has("took too long", 12000), true);
  c.check("and offers a way back", await sd.text(), (s) => s.includes("Try again"));
  await fetch(`${API}/_hang`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: false }) });
  await sd.click("Try again");
  c.check("retrying after it recovers works", await sd.has("Expected bill this month", 12000), true);

  // ---- the panel and the inline badges must not interfere ----
  await setStorage({ session: { token: "tok-owner@example.com", email: "owner@example.com" } });
  const billing = await openPage(PORT, `${SITE}/billing.html`);
  const bd = panelDriver(billing);
  await billing.waitFor("!!document.querySelector('.paisa-badge')");
  await sleep(800);
  await bd.open();
  await bd.has("Expected bill this month");
  await sleep(1500);
  c.check("the billing page keeps its inline badges", await billing.ev("document.querySelectorAll('.paisa-badge,.paisa-inline').length"), 4);
  c.check("and the scanner never badges the panel itself", await billing.ev(`${PANEL_SHADOW}.querySelectorAll('[data-paisa]').length`), 0);
  if (shotDir) await billing.screenshot(`${shotDir}/panel-over-billing.png`);

  const errors = [...page.errors, ...ext.errors, ...report.errors, ...empty.errors, ...stuck.errors, ...billing.errors];
  c.check("no console errors", errors.length, 0);
  if (errors.length) console.log(errors);
} finally {
  proc.kill();
}

process.exit(c.summary() ? 0 : 1);
