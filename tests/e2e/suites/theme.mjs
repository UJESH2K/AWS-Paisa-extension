// Does the panel belong on the page: does it follow the AWS console's own
// theme, and does it survive the console re-rendering the DOM?
import { Checks, PANEL_HOST, PANEL_SHADOW, launch, openPage, sleep } from "../harness.mjs";

const [extDir, shotDir] = process.argv.slice(2);
const PORT = 9577;
const SITE = "http://localhost:8765";
const c = new Checks("theme");
const { proc } = await launch({ extDir, port: PORT, profileTag: "paisa-theme" });

try {
  // ---- a light console ----
  const light = await openPage(PORT, `${SITE}/home.html`);
  await light.waitFor(`!!${PANEL_HOST}`);
  await sleep(600);
  c.check("on a light console the panel is light", await light.ev(`${PANEL_HOST}.getAttribute('data-theme')`), "light");

  const fab = await light.ev(`(()=>{
    const s=getComputedStyle(${PANEL_SHADOW}.querySelector('.fab'));
    return {bg:s.backgroundColor, radius:s.borderRadius, font:s.fontFamily};
  })()`);
  c.check("the button uses the console's blue", fab.bg, "rgb(0, 108, 224)");
  c.check("the button is pill-shaped, like a console button", fab.radius, "20px");
  c.check("the console font stack is applied", fab.font, (s) => s.replace(/"/g, "").startsWith("Amazon Ember"));

  await light.ev(`${PANEL_SHADOW}.querySelector('.fab').click()`);
  await sleep(400);
  c.check(
    "the drawer is light too",
    await light.ev(`getComputedStyle(${PANEL_SHADOW}.querySelector('.drawer')).backgroundColor`),
    "rgb(255, 255, 255)",
  );
  if (shotDir) await light.screenshot(`${shotDir}/panel-light.png`);

  // ---- a dark console ----
  const dark = await openPage(PORT, `${SITE}/console-dark.html`);
  await dark.waitFor(`!!${PANEL_HOST}`);
  await sleep(600);
  c.check("on a dark console the panel is dark", await dark.ev(`${PANEL_HOST}.getAttribute('data-theme')`), "dark");
  await dark.ev(`${PANEL_SHADOW}.querySelector('.fab').click()`);
  await sleep(400);
  c.check(
    "the drawer is dark too",
    await dark.ev(`getComputedStyle(${PANEL_SHADOW}.querySelector('.drawer')).backgroundColor`),
    "rgb(22, 29, 38)",
  );
  c.check(
    "and the accent is the dark-mode blue",
    await dark.ev(`getComputedStyle(${PANEL_SHADOW}.querySelector('.fab')).backgroundColor`),
    "rgb(66, 180, 255)",
  );
  if (shotDir) await dark.screenshot(`${shotDir}/panel-dark.png`);

  // ---- the user toggles the console's own theme while we are open ----
  await dark.ev("document.body.classList.remove('awsui-dark-mode'); document.body.style.background='#ffffff'");
  c.check("it follows the console switching to light", await dark.waitFor(`${PANEL_HOST}.getAttribute('data-theme')==='light'`, 6000), true);
  await dark.ev("document.body.classList.add('awsui-dark-mode'); document.body.style.background='#0f1b2a'");
  c.check("and back to dark", await dark.waitFor(`${PANEL_HOST}.getAttribute('data-theme')==='dark'`, 6000), true);

  // ---- the console is a single-page app and re-renders whole subtrees ----
  await dark.ev("document.getElementById('wipe') && document.getElementById('wipe').click()");
  await dark.ev(`${PANEL_HOST} && ${PANEL_HOST}.remove()`);
  c.check("it re-attaches after the console removes it", await dark.waitFor(`!!${PANEL_HOST}`, 8000), true);
  c.check("and is still themed correctly", await dark.ev(`${PANEL_HOST}.getAttribute('data-theme')`), "dark");

  const errors = [...light.errors, ...dark.errors];
  c.check("no uncaught exceptions", errors.length, 0);
  if (errors.length) console.log(errors);
} finally {
  proc.kill();
}

process.exit(c.summary() ? 0 : 1);
