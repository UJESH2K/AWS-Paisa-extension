// The inline rupee badges the content script injects next to dollar figures on
// AWS billing pages, and the readings it records so changes can be shown.
import { Checks, inr0, launch, near, openPage, parseInr, sleep, usd } from "../harness.mjs";

const [extDir, shotDir] = process.argv.slice(2);
const PORT = 9444;
const SITE = "http://localhost:8765";
const c = new Checks("badge");
const { proc, extensionId } = await launch({ extDir, port: PORT, profileTag: "paisa-badge" });

try {
  const page = await openPage(PORT, `${SITE}/billing.html`);
  c.check("a badge is injected on the billing page", await page.waitFor("!!document.querySelector('.paisa-badge')"), true);
  await sleep(800);

  const found = await page.ev(`({
    primary: document.querySelector('.paisa-badge')?.textContent,
    inline: [...document.querySelectorAll('.paisa-inline')].map(e=>e.textContent),
    count: document.querySelectorAll('.paisa-badge,.paisa-inline').length,
  })`);
  const placement = await page.ev(`(()=>{
    const b=document.querySelector('.paisa-badge');
    const big=document.getElementById('big');
    const n=document.getElementById('n').getBoundingClientRect();
    const r=b.getBoundingClientRect();
    return {inside:b.parentElement===big, sameLine:r.top<n.bottom&&r.bottom>n.top, fontPx:parseFloat(getComputedStyle(b).fontSize)};
  })()`);

  c.check("the headline badge attaches to the month-to-date figure", placement.inside, true);
  c.check("it sits on the same line as that figure", placement.sameLine, true);
  c.check("it is large enough to read", placement.fontPx, (v) => v >= 12);
  c.check("it shows a rupee amount", found.primary, (s) => /^≈ ₹[\d,]+$/.test(s));
  c.check("other amounts get a small rupee figure too", found.inline.length, 3);
  // The page also contains "-$5.00" (a credit) and "$10" inside a sentence.
  c.check("credits and prose dollar amounts are left alone", found.count, 4);

  // Read the rate the extension actually fetched, so the expected value is
  // derived rather than hard-coded.
  const popup = await openPage(PORT, `chrome-extension://${extensionId}/popup.html`);
  await popup.waitFor("document.getElementById('fxRate').textContent.includes('₹')");
  const fx = await popup.ev("new Promise(r=>chrome.storage.local.get('fx',d=>r(d.fx)))");
  c.check("the rate came from the local fixture, not a third-party API", fx.rate, 90);
  c.check("the badge equals USD x rate x markup x GST", found.primary, `≈ ${inr0(47.3 * fx.rate * 1.035 * 1.18)}`);

  // The console updates its figure in place; the badge must follow.
  await page.ev("document.getElementById('n').textContent='52.30'");
  c.check(
    "the badge follows when the dollar figure changes",
    await page.waitFor(
      `document.querySelector('.paisa-badge')?.textContent === ${JSON.stringify(`≈ ${inr0(52.3 * fx.rate * 1.035 * 1.18)}`)}`,
    ),
    true,
  );
  await sleep(1500);

  const history = await popup.ev(
    "new Promise(r=>chrome.storage.local.get('history',d=>r(d.history.map(h=>[h.label,h.usd,h.src]))))",
  );
  c.check(
    "both readings are recorded",
    JSON.stringify(history),
    JSON.stringify([["Month-to-date", 47.3, "page"], ["Month-to-date", 52.3, "page"]]),
  );

  // A fresh popup shows the change between those two readings.
  const popup2 = await openPage(PORT, `chrome-extension://${extensionId}/popup.html`);
  await popup2.send("Emulation.setDeviceMetricsOverride", { width: 380, height: 900, deviceScaleFactor: 2, mobile: false });
  await popup2.waitFor("document.getElementById('heroInr').textContent.includes('₹')");
  await sleep(600);
  const ui = await popup2.ev(`({
    hero: document.getElementById('heroInr').textContent,
    change: document.querySelector('.delta')?.textContent,
    split: document.querySelector('.split')?.textContent,
  })`);
  const spendDelta = 5 * fx.rate * 1.035 * 1.18;
  c.check("the popup headline is the latest total", ui.hero, inr0(52.3 * fx.rate * 1.035 * 1.18));
  c.check("it shows the increase", ui.change, (s) => s.startsWith("▲ +₹") && near(spendDelta)(s));
  c.check(
    "and splits it into spend vs exchange rate",
    ui.split,
    (s) => s.includes(`(+${usd(5)})`) && s.includes("Exchange rate ₹0.00"),
  );

  // Settings must reach the page, not just the popup.
  await popup2.ev("document.querySelector('input[value=AISPL]').click()");
  c.check(
    "switching to AISPL updates the page badge (no card markup)",
    await page.waitFor(
      `document.querySelector('.paisa-badge')?.textContent === ${JSON.stringify(`≈ ${inr0(52.3 * fx.rate * 1.18)}`)}`,
    ),
    true,
  );

  await popup2.ev(
    "(()=>{const e=document.getElementById('calcUsd');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'100');e.dispatchEvent(new Event('input',{bubbles:true}));})()",
  );
  c.check("the calculator uses the same maths", await popup2.ev("document.getElementById('calcOut').textContent"), near(100 * fx.rate * 1.18));

  await page.ev("document.querySelector('.paisa-badge').click()");
  await sleep(400);
  c.check("clicking the badge opens the breakdown", await page.ev("!!document.querySelector('.paisa-pop')"), true);
  if (shotDir) await page.screenshot(`${shotDir}/billing-badge.png`);

  // Awkward real-world layouts: "USD 12.34", "12.34 USD", shadow DOM, iframes.
  const other = await openPage(PORT, `${SITE}/billing2.html`);
  await other.waitFor("document.querySelectorAll('.paisa-badge,.paisa-inline').length>=3", 12000);
  await sleep(1200);
  const variants = await other.ev(`(()=>{
    const sh=document.getElementById('host').shadowRoot;
    const badge=document.querySelector('.paisa-badge');
    return {
      primary: badge?.parentElement?.textContent.replace(badge.textContent,'').trim(),
      loose: document.getElementById('loose').nextElementSibling?.textContent,
      shadow: sh.querySelector('[data-paisa]')?.textContent,
      frame: (()=>{try{return document.querySelector('iframe').contentDocument.querySelector('[data-paisa]')?.textContent}catch(e){return 'ERR '+e.message}})(),
    };
  })()`);
  c.check("'USD 12.34' is recognised", variants.primary, "USD 12.34");
  c.check("'250.00 USD' is recognised", variants.loose, (s) => /^≈ ₹/.test(s));
  c.check("an amount inside a shadow root is recognised", variants.shadow, (s) => /^≈ ₹/.test(s));
  c.check("an amount inside an iframe is recognised", variants.frame, (s) => /^≈ ₹/.test(s));

  // A page with no figures must stay untouched rather than guess.
  const empty = await openPage(PORT, `${SITE}/empty.html`);
  await sleep(1500);
  c.check("a page with no dollar figure gets no badges", await empty.ev("document.querySelectorAll('.paisa-badge,.paisa-inline').length"), 0);

  // The scanner is allowed on every console page, so it must stay quiet on
  // pages that talk about dollars without being your bill.
  const market = await openPage(PORT, `${SITE}/marketplace.html`);
  await sleep(1800);
  c.check(
    "a non-billing console page with prices is left alone",
    await market.ev("document.querySelectorAll('.paisa-badge,.paisa-inline').length"),
    0,
  );

  const errors = [...page.errors, ...popup.errors, ...popup2.errors, ...other.errors, ...empty.errors, ...market.errors];
  c.check("no console errors anywhere", errors.length, 0);
  if (errors.length) console.log(errors);
} finally {
  proc.kill();
}

process.exit(c.summary() ? 0 : 1);
