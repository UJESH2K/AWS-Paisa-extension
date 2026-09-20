// Shared plumbing for the browser end-to-end suites.
//
// These load the real unpacked extension into headless Edge (or Chrome) and
// drive it over the DevTools protocol, so what is asserted is the extension a
// user would install, not a mock of it. No AWS account is involved: the suites
// run against local fixture pages and a local stand-in API.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const BROWSERS = [
  process.env.PAISA_BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean);

export function findBrowser() {
  const found = BROWSERS.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error("No Edge/Chrome found. Set PAISA_BROWSER to the browser executable.");
  }
  return found;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts a headless browser, with the unpacked extension loaded if given one.
 *  Omit extDir to test a plain web page (the dashboard). */
export async function launch({ extDir, port, profileTag = "paisa" }) {
  const proc = spawn(
    findBrowser(),
    [
      "--headless=new",
      "--disable-gpu",
      // CI containers run as root, where Chrome refuses to start sandboxed.
      ...(process.platform === "win32" ? [] : ["--no-sandbox", "--disable-dev-shm-usage"]),
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.join(process.env.TEMP || "/tmp", `${profileTag}-${Date.now()}`)}`,
      ...(extDir
        ? [
            `--load-extension=${extDir}`,
            `--disable-extensions-except=${extDir}`,
            // Newer builds disable --load-extension unless this is set.
            "--disable-features=DisableLoadExtensionCommandLineSwitch",
          ]
        : []),
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  if (!extDir) {
    // Nothing to wait for beyond the browser answering.
    for (let i = 0; i < 60; i++) {
      try {
        await (await fetch(`http://127.0.0.1:${port}/json`)).json();
        return { proc, port, extensionId: null };
      } catch {
        await sleep(300);
      }
    }
    proc.kill();
    throw new Error("The browser did not start.");
  }

  const targets = async () => {
    try {
      return await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      return [];
    }
  };

  let worker = null;
  for (let i = 0; i < 60; i++) {
    worker = (await targets()).find((t) => t.type === "service_worker" && t.url.includes("background.js"));
    if (worker) break;
    await sleep(300);
  }
  if (!worker) {
    proc.kill();
    throw new Error("The extension did not load (no service worker appeared).");
  }
  return { proc, port, extensionId: new URL(worker.url).host };
}

/** Opens a tab and returns a small driver for it. Collects page errors. */
export async function openPage(port, url) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${url}`, { method: "PUT" })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error(`Could not attach to ${url}`));
  });

  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
    if (d.method === "Runtime.exceptionThrown") {
      errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    }
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
      errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result.result?.value;

  const waitFor = async (expression, timeoutMs = 8000) => {
    for (let waited = 0; waited < timeoutMs; waited += 200) {
      if (await evaluate(expression)) return true;
      await sleep(200);
    }
    return false;
  };

  const screenshot = async (file) => {
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  };

  await send("Runtime.enable");
  return { send, ev: evaluate, waitFor, screenshot, errors, close: () => ws.close() };
}

/** Records pass/fail so a suite reports every result rather than dying on the first. */
export class Checks {
  constructor(name) {
    this.name = name;
    this.results = [];
  }

  check(label, actual, expected) {
    const ok = typeof expected === "function" ? expected(actual) : actual === expected;
    this.results.push({ label, ok, actual });
    const shown = typeof actual === "string" && actual.length > 110 ? `${actual.slice(0, 110)}…` : JSON.stringify(actual);
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}  ->  ${shown}`);
    return ok;
  }

  get failed() {
    return this.results.filter((r) => !r.ok);
  }

  summary() {
    const passed = this.results.length - this.failed.length;
    console.log(
      this.failed.length === 0
        ? `\n${this.name}: ALL PASS (${passed}/${this.results.length})`
        : `\n${this.name}: FAILURES (${passed}/${this.results.length})`,
    );
    return this.failed.length === 0;
  }
}

// Formatting used by assertions. Note the browser and Node can disagree on
// currency spacing across ICU versions, so prefer asserting on these helpers'
// output rather than hand-written literals.
export const inr0 = (n) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
export const inr2 = (n) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
export const usd = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

/** Pull the rupee amount out of a rendered string, for comparing money that
 *  the extension and the test reached by different arithmetic. Two correct
 *  routes to the same figure can round to different paise, so assert
 *  closeness rather than string equality. */
export function parseInr(text) {
  const m = /₹\s*([\d,]+(?:\.\d+)?)/.exec(String(text || ""));
  return m ? Number(m[1].replace(/,/g, "")) : NaN;
}
export const near = (expected, tolerance = 0.02) => (actual) =>
  Math.abs(parseInr(actual) - expected) <= tolerance;
export { sleep };

/** The panel lives in a shadow root; suites address it through this. */
export const PANEL_HOST = `document.querySelector('[data-paisa="panel-root"]')`;
export const PANEL_SHADOW = `${PANEL_HOST}.shadowRoot`;

/** Convenience wrapper for driving the panel UI. */
export function panelDriver(page) {
  return {
    text: () => page.ev(`${PANEL_SHADOW}.querySelector('.body').innerText`),
    fab: () => page.ev(`${PANEL_SHADOW}.querySelector('.fab').innerText`),
    open: async () => {
      await page.ev(`${PANEL_SHADOW}.querySelector('.fab').click()`);
      await sleep(300);
    },
    click: (label) =>
      page.ev(
        `(()=>{const b=[...${PANEL_SHADOW}.querySelectorAll('button')].find(b=>b.textContent.includes(${JSON.stringify(
          label,
        )})); if(!b) return false; b.click(); return true})()`,
      ),
    type: (id, value) =>
      page.ev(
        `(()=>{const i=${PANEL_SHADOW}.getElementById(${JSON.stringify(id)}); if(!i) return false; i.value=${JSON.stringify(
          value,
        )}; i.dispatchEvent(new Event('input',{bubbles:true})); return true})()`,
      ),
    // Headings are uppercased by CSS, so compare case-insensitively.
    has: (needle, timeoutMs = 8000) =>
      page.waitFor(
        `${PANEL_SHADOW}.querySelector('.body').innerText.toLowerCase().includes(${JSON.stringify(
          needle.toLowerCase(),
        )})`,
        timeoutMs,
      ),
  };
}
