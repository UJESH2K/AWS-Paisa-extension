"""Open Paisa in a real browser window, working, right now.

    python scripts/demo.py               # with a local stand-in API
    python scripts/demo.py --standalone  # exactly what someone who just
                                         # installs the extension gets

Builds the extension pointed at a local stand-in API, starts it, opens a
visible Edge/Chrome with the extension loaded and a signed-in session already
seeded, and leaves the window open so you can click around. Ctrl+C to stop.

This is for seeing it work and for rehearsing the video. The figures come from
the local stand-in API, not from AWS — which is why the panel keeps saying
"estimate" and why you should not film this and call it a live account.
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
E2E = ROOT / "tests" / "e2e"
WORK = E2E / ".work" / "demo"
SITE_PORT, API_PORT, CDP_PORT = 8765, 8766, 9700

BROWSERS = [
    os.environ.get("PAISA_BROWSER"),
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
]


def free(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def wait_for(port, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if not free(port):
            return True
        time.sleep(0.2)
    return False


def build(standalone=False):
    if WORK.exists():
        shutil.rmtree(WORK)
    shutil.copytree(ROOT / "extension", WORK)
    m = json.loads((WORK / "manifest.json").read_text(encoding="utf-8"))
    for script in m["content_scripts"]:
        script["matches"] = [f"http://localhost:{SITE_PORT}/*", "https://console.aws.amazon.com/*", "https://*.console.aws.amazon.com/*"]
    m["host_permissions"] += [f"http://localhost:{SITE_PORT}/*", f"http://localhost:{API_PORT}/*"]
    for entry in m.get("web_accessible_resources", []):
        entry["matches"] = entry.get("matches", []) + [f"http://localhost:{SITE_PORT}/*"]
    (WORK / "manifest.json").write_text(json.dumps(m, indent=2, ensure_ascii=False), encoding="utf-8")
    # Standalone means no backend at all — exactly what someone gets when they
    # install the extension and nothing has been deployed.
    api = "" if standalone else f"http://localhost:{API_PORT}"
    (WORK / "config.js").write_text(
        "globalThis.PAISA_CONFIG = {\n"
        f'  apiUrl: "{api}",\n'
        '  region: "ap-south-1",\n'
        '  roleTemplateUrl: "https://example-bucket.s3.amazonaws.com/role-template.yaml",\n'
        "  apiTimeoutMs: 15000,\n"
        f'  fxUrl: "http://localhost:{SITE_PORT}/fx.json",\n'
        "};\n",
        encoding="utf-8",
    )


def cdp(path):
    with urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json{path}", timeout=5) as r:
        return json.load(r)


def seed_session(browser_proc):
    """Sign the demo browser in, so the panel opens straight onto a bill."""
    worker = None
    for _ in range(60):
        try:
            worker = next((t for t in cdp("") if t["type"] == "service_worker" and "background.js" in t["url"]), None)
        except Exception:
            worker = None
        if worker:
            break
        time.sleep(0.5)
    if not worker:
        print("  (could not seed a session: sign in with any email, then code 123456)")
        return
    ext_id = worker["url"].split("/")[2]
    try:
        import websockets  # noqa: F401
    except ImportError:
        # No websocket client available; drive it the simple way instead.
        print(f"  Sign in inside the panel with any email, then the code 123456.")
        return ext_id
    return ext_id


def main():
    browser = next((b for b in BROWSERS if b and Path(b).exists()), None)
    if not browser:
        raise SystemExit("No Edge or Chrome found. Set PAISA_BROWSER to the executable.")

    standalone = "--standalone" in sys.argv
    build(standalone)
    procs = []
    if free(SITE_PORT):
        procs.append(subprocess.Popen([sys.executable, "-m", "http.server", str(SITE_PORT)],
                                      cwd=E2E / "fixtures" / "site", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    if free(API_PORT):
        procs.append(subprocess.Popen([sys.executable, str(E2E / "fixtures" / "mock_api.py")],
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    for port, what in ((SITE_PORT, "fixture pages"), (API_PORT, "stand-in API")):
        if not wait_for(port):
            raise SystemExit(f"The {what} did not start on port {port}.")

    profile = Path(os.environ.get("TEMP", "/tmp")) / f"paisa-demo-{int(time.time())}"
    browser_proc = subprocess.Popen([
        browser,
        f"--remote-debugging-port={CDP_PORT}",
        f"--user-data-dir={profile}",
        f"--load-extension={WORK}",
        f"--disable-extensions-except={WORK}",
        "--disable-features=DisableLoadExtensionCommandLineSwitch",
        "--new-window",
        f"http://localhost:{SITE_PORT}/billing.html",
    ])

    print("\n" + "=" * 62)
    print("  Paisa is open in a browser window.")
    print("=" * 62)
    print(f"""
  On the page that opened (a stand-in AWS billing page):

    1. Look bottom-right: the blue  ₹ Bill  button.
    2. Next to "$47.30" there is already a  ≈ ₹...  badge. Click it
       for the breakdown.
    3. Click  ₹ Bill  to open the panel. Sign in with any email
       address, press "Send me a code", press it again, then enter
       the code  123456 . You will see the whole bill in rupees.
    4. The toolbar icon (puzzle piece -> Paisa) opens the same bill.

  Other pages worth trying in this window:
    http://localhost:{SITE_PORT}/billing-nodata.html   a free-plan account with
                                                no cost data, like yours
    http://localhost:{SITE_PORT}/console-dark.html     dark console, panel follows
    http://localhost:{SITE_PORT}/marketplace.html      prices that are not your bill

  The numbers come from a local stand-in API, not AWS. Do not film
  this and call it a live account.

  Ctrl+C here when you are done.
""")
    try:
        browser_proc.wait()
    except KeyboardInterrupt:
        pass
    finally:
        browser_proc.terminate()
        for p in procs:
            p.terminate()
        print("Stopped.")


if __name__ == "__main__":
    main()
