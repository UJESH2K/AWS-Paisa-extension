// The toolbar popup: the surface you get when you are not on a console page.
// It must show the same bill as the panel, and — the subtle part — its
// settings must reach the server, so the badge on the page, the bill in the
// panel and the emailed summary never disagree.
import { Checks, inr0, launch, near, openPage, sleep, usd } from "../harness.mjs";

const [extDir, shotDir] = process.argv.slice(2);
const PORT = 9566;
const SITE = "http://localhost:8765";
const API = "http://127.0.0.1:8766";
const c = new Checks("popup");
const { proc, extensionId } = await launch({ extDir, port: PORT, profileTag: "paisa-popup" });
const POPUP = `chrome-extension://${extensionId}/popup.html`;

const el = (id) => `document.getElementById(${JSON.stringify(id)})`;
const text = (page, id) => page.ev(`${el(id)}.textContent`);
const visible = (page, id) => page.ev(`!${el(id)}.hidden`);
const click = (page, id) => page.ev(`${el(id)}.click()`);
const type = (page, id, v) =>
  page.ev(`(()=>{const i=${el(id)}; i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`);

try {
  // ---- signed out ----
  const p1 = await openPage(PORT, POPUP);
  await p1.waitFor(`${el("fxRate")}.textContent.includes('₹')`);
  await sleep(400);
  c.check("signed out: offers sign-in", await visible(p1, "authSec"), true);
  c.check("signed out: no bill is shown", await visible(p1, "billSec"), false);
  c.check("settings say they are local only", await text(p1, "settingsScope"), (s) => s.includes("Saved in this browser"));

  const fx = await p1.ev("new Promise(r=>chrome.storage.local.get('fx',d=>r(d.fx)))");
  await type(p1, "calcUsd", "100");
  c.check("the calculator works without signing in", await text(p1, "calcOut"), near(100 * fx.rate * 1.035 * 1.18));

  // ---- signing in, from the popup itself ----
  await type(p1, "authEmail", "owner@example.com");
  await click(p1, "authGo");
  c.check("first sign-in asks to confirm the address", await p1.waitFor(`${el("authTitle")}.textContent.includes('Confirm')`), true);
  await click(p1, "authGo");
  c.check("then it asks for the code", await p1.waitFor(`${el("authTitle")}.textContent.includes('Enter your code')`), true);
  await type(p1, "authCode", "123456");
  await click(p1, "authGo");
  c.check("the bill appears after signing in", await p1.waitFor(`!${el("billSec")}.hidden`), true);
  await sleep(500);

  const total = 47.3 * 95.88 * 1.035 * 1.18;
  c.check("it is the same total the panel shows", await text(p1, "billTotal"), inr0(total));
  c.check("with the USD figure it came from", await text(p1, "billSub"), (s) => s.includes(usd(47.3)));
  c.check("the projection names GST and markup", await text(p1, "billProjectionSub"), (s) => s.includes("18% GST") && s.includes("3.5% card markup"));
  c.check("the breakdown is fully visible", await text(p1, "bBaseLabel"), `${usd(47.3)} × ₹95.88`);
  c.check("top services are listed", await p1.ev(`${el("billServices")}.children.length`), (n) => n >= 5);
  c.check("the standalone readings view steps aside", await visible(p1, "heroSec"), false);
  c.check("settings now say they are account-wide", await text(p1, "settingsScope"), (s) => s.includes("Saved to your Paisa account"));
  if (shotDir) await p1.screenshot(`${shotDir}/popup-bill.png`);

  // ---- the settings-sync guarantee ----
  await p1.ev("document.querySelector('input[value=AISPL]').click()");
  c.check(
    "switching entity re-reads the bill without card markup",
    await p1.waitFor(`${el("bMarkup")}.textContent === '₹0.00'`, 8000),
    true,
  );
  c.check("and the new total follows", await text(p1, "billTotal"), inr0(47.3 * 95.88 * 1.18));

  const log = await (await fetch(`${API}/_log`)).json();
  c.check("the change was sent to the server, not just stored locally", log.some(([m, path]) => m === "PUT" && path === "/settings"), true);
  const stored = await p1.ev("new Promise(r=>chrome.storage.local.get('settings',d=>r(d.settings)))");
  c.check("and mirrored into storage, so page badges agree", stored.entity, "AISPL");

  // A fresh popup must come back with the server's view, not a stale local one.
  const p2 = await openPage(PORT, POPUP);
  await p2.waitFor(`!${el("billSec")}.hidden`);
  await sleep(400);
  c.check("a fresh popup reflects the server's settings", await text(p2, "bMarkup"), "₹0.00");

  // ---- the actions ----
  await click(p2, "billEmail");
  c.check("emailing the summary confirms where it went", await p2.waitFor(`${el("billMsg")}.textContent.includes('Sent to owner@example.com')`), true);
  await click(p2, "billRefresh");
  await sleep(700);
  const log2 = await (await fetch(`${API}/_log`)).json();
  c.check("refresh asks the server to re-read", log2.some(([m, path]) => m === "GET" && path === "/spend?refresh=1"), true);

  // ---- an account with no role connected ----
  await p2.ev("new Promise(r=>chrome.storage.local.set({session:{token:'tok-stranger@example.com',email:'stranger@example.com'}},()=>r(true)))");
  const p3 = await openPage(PORT, POPUP);
  await sleep(1200);
  c.check(
    "an unconnected account is pointed at the console button",
    await text(p3, "billMsg"),
    (s) => s.includes("Connect your AWS account"),
  );

  // ---- deleting your data ----
  const p4 = await openPage(PORT, POPUP);
  await p4.ev("new Promise(r=>chrome.storage.local.set({session:{token:'tok-owner@example.com',email:'owner@example.com'}},()=>r(true)))");
  const p5 = await openPage(PORT, POPUP);
  await p5.waitFor(`!${el("acctSec")}.hidden`);
  c.check("a signed-in user is offered deletion", await visible(p5, "acctSec"), true);
  c.check("deletion is not one careless click", await visible(p5, "deleteConfirm"), false);
  await click(p5, "deleteAcct");
  c.check("confirming warns it cannot be undone", await p5.ev(`${el("deleteConfirm")}.innerText`), (s) => s.includes("cannot be undone"));
  c.check("and is honest that the AWS role is not ours to delete", await p5.ev(`${el("deleteConfirm")}.innerText`), (s) => s.includes("CloudFormation"));
  await click(p5, "deleteYes");
  c.check("deleting says what is left behind", await p5.waitFor(`${el("acctMsg")}.textContent.includes('Deleted')`), true);
  c.check("the local session is cleared too", await p5.ev("new Promise(r=>chrome.storage.local.get('session',d=>r(d.session||null)))"), null);
  c.check("and it falls back to the signed-out view", await visible(p5, "authSec"), true);

  const errors = [...p1.errors, ...p2.errors, ...p3.errors, ...p4.errors, ...p5.errors];
  c.check("no console errors", errors.length, 0);
  if (errors.length) console.log(errors);
} finally {
  proc.kill();
}

process.exit(c.summary() ? 0 : 1);
