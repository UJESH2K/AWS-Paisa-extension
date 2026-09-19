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
    // A build with no server must say so, not show a sign-in form that cannot work.
    const page = await openPage(PORT, `${SITE}/home.html`);
    const d = panelDriver(page);
    c.check("the button still appears on a non-billing console page", await page.waitFor(`!!${PANEL_HOST}`), true);
    await d.open();
    c.check("it admits there is no server configured", await d.has("Not connected yet"), true);
    await d.click("See a sample bill");
    await sleep(300);
    const text = await d.text();
    c.check("the sample is labelled as sample data", text.includes("Sample data, not your account."), true);
    c.check("and still shows a rupee total", text.toLowerCase().includes("so far"), true);
    c.check("no console errors", [...page.errors, ...ext.errors].length, 0);
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

  const errors = [...page.errors, ...ext.errors, ...billing.errors];
  c.check("no console errors", errors.length, 0);
  if (errors.length) console.log(errors);
} finally {
  proc.kill();
}

process.exit(c.summary() ? 0 : 1);
