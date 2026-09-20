// The Next.js dashboard: the surface for people who do not want to install an
// extension. Until now it only had lint and build, so nothing checked that it
// actually works. Driven against the same stand-in API as the extension, so
// both surfaces are held to the same numbers.
//
// Two things to know if you extend this:
//   - Card headings are uppercased by CSS, and innerText reflects that, so all
//     text matching here is case-insensitive.
//   - The page is server-rendered, so inputs exist before React hydrates.
//     Typing too early is silently discarded; fillUntil retries until the app
//     has actually taken the value.
import { Checks, launch, near, openPage, sleep } from "../harness.mjs";

const [, shotDir] = process.argv.slice(2);
const PORT = 9588;
const WEB = "http://localhost:3100";
const c = new Checks("web");
const { proc } = await launch({ port: PORT, profileTag: "paisa-web" });

const lower = async (page) => (await page.ev("document.body.innerText")).toLowerCase();
const has = (text) => (body) => body.includes(text.toLowerCase());
const headline = (page) => page.ev(`document.querySelector('section p.num')?.innerText ?? null`);

const buttonEnabled = (label) =>
  `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)})); return !!b && !b.disabled;})()`;

function driver(page) {
  // Writing through the native setter is the usual way to drive a React
  // controlled input, but a write that lands before hydration poisons React's
  // value tracker: it initialises from the DOM value, so an identical later
  // write looks like "no change" and state never updates. Always write a
  // scratch value first, so the real one is always a change.
  const set = (id, value) =>
    page.ev(`(()=>{
      const i = document.getElementById(${JSON.stringify(id)});
      if (!i) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      for (const v of ["", ${JSON.stringify(value)}]) {
        setter.call(i, v);
        i.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return true;
    })()`);
  return {
    /** Types, then waits until the app reacted — the page may still be hydrating.
     *  Reports what it last saw on failure, so a timeout is diagnosable. */
    fillUntil: async (id, value, readyExpr, timeoutMs = 20000) => {
      for (let waited = 0; waited < timeoutMs; waited += 400) {
        await set(id, value);
        await sleep(400);
        if (await page.ev(readyExpr)) return true;
      }
      const state = await page.ev(`({
        value: document.getElementById(${JSON.stringify(id)})?.value ?? null,
        buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim().slice(0, 30) + (b.disabled ? ' [disabled]' : '')),
      })`);
      return `gave up after ${timeoutMs}ms: ${JSON.stringify(state)}`;
    },
    click: (label) =>
      page.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(label)})); if(!b) return false; b.click(); return true;})()`),
    waitForText: (text, timeoutMs = 15000) =>
      page.waitFor(`document.body.innerText.toLowerCase().includes(${JSON.stringify(text.toLowerCase())})`, timeoutMs),
  };
}

try {
  // ---- signed out: sample data, and it must say so ----
  const home = await openPage(PORT, `${WEB}/`);
  await home.waitFor("document.body.innerText.includes('rupees')", 25000);
  await sleep(600);
  const sample = await lower(home);
  c.check("signed out, it shows a bill", sample, has("month to date"));
  c.check("and says plainly that it is sample data", sample, has("this is sample data, not your account."));
  c.check("with the sample chip visible", sample, has("sample data"));
  c.check("every figure is labelled an estimate", sample, has("estimate"));
  c.check("the conversion is broken out", sample, (s) => ["aws console spend", "card forex markup", "gst"].every((x) => s.includes(x)));
  if (shotDir) await home.screenshot(`${shotDir}/web-sample.png`);

  // ---- signing in ----
  const connect = await openPage(PORT, `${WEB}/connect`);
  const d = driver(connect);
  await connect.waitFor("!!document.getElementById('email')", 25000);
  c.check(
    "the sign-in form accepts an address once hydrated",
    await d.fillUntil("email", "owner@example.com", buttonEnabled("Send me a code")),
    true,
  );
  await d.click("Send me a code");
  c.check("first sign-in asks to confirm the address", await d.waitForText("confirm subscription"), true);
  await d.click("I've confirmed");
  c.check("then it asks for the code", await connect.waitFor("!!document.getElementById('code')", 15000), true);
  c.check(
    "the code field accepts six digits",
    await d.fillUntil("code", "123456", buttonEnabled("Sign in")),
    true,
  );
  await d.click("Sign in");
  c.check("signing in is acknowledged", await d.waitForText("signed in as owner@example.com"), true);
  // The stand-in API reports this address as the deployment's owner, so it
  // should say the account is already connected rather than asking for a role.
  c.check("an owner is told there is nothing more to set up", await lower(connect), has("already connected"));
  if (shotDir) await connect.screenshot(`${shotDir}/web-connect.png`);

  // ---- the real bill ----
  const dash = await openPage(PORT, `${WEB}/`);
  const dd = driver(dash);
  c.check("the dashboard switches to live data", await dd.waitForText("live · your account", 25000), true);
  await sleep(800);
  const live = await lower(dash);
  c.check("and drops the sample-data warning", live, (s) => !s.includes("this is sample data, not your account."));

  const total = 47.3 * 95.88 * 1.035 * 1.18;
  c.check("the headline matches the API's figures", await headline(dash), near(total, 1));
  c.check("the USD it came from is shown", live, has("$47.30"));
  c.check("services are listed in rupees", live, (s) => ["amazon ec2", "amazon rds", "amazon s3"].every((x) => s.includes(x)));
  c.check("the email controls appear once signed in", live, has("email me this summary now"));
  if (shotDir) await dash.screenshot(`${shotDir}/web-live.png`);

  // ---- assumptions recompute in place ----
  await dash.ev(`document.querySelector('input[value="AISPL"]').click()`);
  await sleep(700);
  c.check("switching to AISPL removes the card markup", await lower(dash), has("not applicable (aispl)"));
  c.check("and the total drops accordingly", await headline(dash), near(47.3 * 95.88 * 1.18, 1));

  const errors = [...home.errors, ...connect.errors, ...dash.errors];
  c.check("no console errors", errors.length, 0);
  if (errors.length) console.log(errors);
} finally {
  proc.kill();
}

process.exit(c.summary() ? 0 : 1);
