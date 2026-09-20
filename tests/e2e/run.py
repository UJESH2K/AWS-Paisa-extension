"""Run the browser end-to-end suites.

    python tests/e2e/run.py            # all suites
    python tests/e2e/run.py theme      # one suite

Builds throwaway copies of extension/ whose manifests point at local fixture
pages instead of console.aws.amazon.com, serves those pages, starts a stand-in
Paisa API, then drives the real unpacked extension in headless Edge/Chrome.
No AWS account and no network access to AWS are involved.
"""
import json
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
E2E = ROOT / "tests" / "e2e"
WORK = E2E / ".work"
SITE_PORT = 8765
API_PORT = 8766

SUITES = {
    "badge": ("badge.mjs", "ext-panel"),
    "panel": ("panel.mjs", "ext-panel"),
    "panel-noapi": ("panel.mjs", "ext-noapi"),
    "popup": ("popup.mjs", "ext-panel"),
    "theme": ("theme.mjs", "ext-panel"),
}


def build_extension_copies():
    """Copy extension/ and repoint the manifest at the local fixture server."""
    WORK.mkdir(parents=True, exist_ok=True)
    for name, api_url in (("ext-panel", f"http://localhost:{API_PORT}"), ("ext-noapi", "")):
        dest = WORK / name
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(ROOT / "extension", dest)
        manifest = json.loads((dest / "manifest.json").read_text(encoding="utf-8"))
        # Both scripts cover every console page in the real manifest; the badge
        # scanner decides for itself whether a page is about money.
        manifest["content_scripts"][0]["matches"] = [f"http://localhost:{SITE_PORT}/*"]
        manifest["content_scripts"][1]["matches"] = [f"http://localhost:{SITE_PORT}/*"]
        manifest["host_permissions"] += [f"http://localhost:{SITE_PORT}/*", f"http://localhost:{API_PORT}/*"]
        (dest / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")
        if api_url:
            (dest / "config.js").write_text(
                "globalThis.PAISA_CONFIG = {\n"
                f'  apiUrl: "{api_url}",\n'
                '  region: "ap-south-1",\n'
                '  roleTemplateUrl: "https://example-bucket.s3.amazonaws.com/role-template.yaml",\n'
                # Short, so the timeout suite does not sit for the production 15s.
                '  apiTimeoutMs: 1500,\n'
                "};\n",
                encoding="utf-8",
            )
    return WORK / "ext-panel", WORK / "ext-noapi"


def port_is_free(port):
    with socket.socket() as s:
        return s.connect_ex(("127.0.0.1", port)) != 0


def wait_for_port(port, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not port_is_free(port):
            return True
        time.sleep(0.2)
    return False


def wait_for_port_free(port, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_is_free(port):
            return True
        time.sleep(0.2)
    return False


def start_site_server():
    """Static fixture pages. Stateless, so one instance serves every suite."""
    if not port_is_free(SITE_PORT):
        return None
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(SITE_PORT)],
        cwd=E2E / "fixtures" / "site",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not wait_for_port(SITE_PORT):
        proc.terminate()
        raise SystemExit(f"The fixture site did not start on port {SITE_PORT}.")
    return proc


def start_api_server():
    """The stand-in API accumulates state (sessions, settings, connected roles),
    so each suite gets its own instance. Sharing one made results depend on the
    order suites ran in."""
    if not wait_for_port_free(API_PORT):
        raise SystemExit(f"Port {API_PORT} is still in use; a previous stand-in API did not exit.")
    proc = subprocess.Popen(
        [sys.executable, str(E2E / "fixtures" / "mock_api.py")],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not wait_for_port(API_PORT):
        proc.terminate()
        raise SystemExit(f"The stand-in API did not start on port {API_PORT}.")
    return proc


def main():
    wanted = sys.argv[1:] or list(SUITES)
    unknown = [w for w in wanted if w not in SUITES]
    if unknown:
        raise SystemExit(f"Unknown suite(s): {', '.join(unknown)}. Available: {', '.join(SUITES)}")

    if not shutil.which("node"):
        raise SystemExit("node is required to run the browser suites.")

    build_extension_copies()
    site = start_site_server()
    results = {}
    try:
        for name in wanted:
            script, ext = SUITES[name]
            print(f"\n{'=' * 60}\n{name}\n{'=' * 60}", flush=True)
            mode = "noapi" if name.endswith("-noapi") else ""
            cmd = [
                "node",
                str(E2E / "suites" / script),
                str(WORK / ext),
                str(WORK / "screenshots" / name),
            ]
            if mode:
                cmd.append(mode)
            api = start_api_server()  # a clean API per suite
            try:
                results[name] = subprocess.run(cmd, cwd=ROOT).returncode == 0
            finally:
                api.terminate()
                api.wait(timeout=10)
    finally:
        if site:
            site.terminate()

    print(f"\n{'=' * 60}")
    for name, ok in results.items():
        print(f"  {'PASS' if ok else 'FAIL'}  {name}")
    failed = [n for n, ok in results.items() if not ok]
    print(f"{'=' * 60}")
    if failed:
        print(f"{len(failed)} suite(s) failed: {', '.join(failed)}")
        return 1
    print(f"All {len(results)} suite(s) passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
