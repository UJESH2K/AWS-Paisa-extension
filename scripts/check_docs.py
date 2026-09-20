"""Verify that what the docs claim matches what the repo actually does.

Test counts and version numbers drift every time anyone adds a test, and a
stale figure is worse here than elsewhere: docs/demo.md tells someone what to
say out loud while a terminal showing the real number is on screen. That has
gone wrong three times, so it is checked rather than remembered.

    python scripts/check_docs.py

Exit code 0 if every claim matches, 1 otherwise. The browser-suite total comes
from the last run of tests/e2e/run.py; if it has never run, that check is
skipped and says so rather than guessing.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ["README.md", "WRITEUP.md", "SUBMISSION.md", "docs/demo.md", "docs/architecture.md", "tests/e2e/README.md"]


def backend_test_count():
    out = subprocess.run(
        [sys.executable, "-m", "pytest", "backend/tests", "--collect-only", "-q"],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    m = re.search(r"(\d+) tests? collected", out.stdout + out.stderr)
    if not m:
        raise SystemExit("Could not count the backend tests. Is pytest installed?")
    return int(m.group(1))


def e2e_check_count():
    summary = ROOT / "tests" / "e2e" / ".work" / "summary.json"
    if not summary.exists():
        return None, None
    data = json.loads(summary.read_text(encoding="utf-8"))
    return data.get("suites"), data.get("checks")


def extension_version():
    return json.loads((ROOT / "extension" / "manifest.json").read_text(encoding="utf-8"))["version"]


def main():
    backend = backend_test_count()
    suites, checks = e2e_check_count()
    version = extension_version()

    # (regex, what the captured groups should equal, human name)
    rules = [
        (r"(\d+) backend tests", [backend], "backend test count"),
        (r"# (\d+) tests: conversion maths", [backend], "backend test count"),
        (r"(\d+) backend tests against mocked AWS", [backend], "backend test count (spoken in the demo)"),
        (r"paisa-extension-(\d+\.\d+\.\d+)\.zip", [version], "packaged extension version"),
        (r"Extension (\d+\.\d+\.\d+)", [version], "extension version"),
    ]
    if checks is not None:
        rules += [
            (r"(\d+) browser suites? \((\d+) checks\)", [suites, checks], "browser suite and check counts"),
            (r"(\d+) browser suites, (\d+) checks", [suites, checks], "browser suite and check counts"),
            (r"# (\d+) suites, (\d+) checks", [suites, checks], "browser suite and check counts"),
            (r"and (\d+) checks that load", [checks], "browser check count (spoken in the demo)"),
            (r"(\d+) browser checks across (\d+) suites", [checks, suites], "browser check and suite counts"),
        ]

    problems = []
    for name in DOCS:
        path = ROOT / name
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        for line_no, line in enumerate(text.splitlines(), 1):
            for pattern, expected, label in rules:
                for match in re.finditer(pattern, line):
                    found = [g for g in match.groups() if g is not None]
                    want = [str(e) for e in expected[: len(found)]]
                    if found != want:
                        problems.append(f"{name}:{line_no}  {label}: says {found}, should be {want}\n    {line.strip()[:120]}")

        # Number words in a test-count sentence cannot be checked, so ban them.
        for line_no, line in enumerate(text.splitlines(), 1):
            if re.search(r"\b(?:seventy|eighty|ninety|hundred)[a-z-]*\s+(?:backend\s+)?(?:tests|checks)", line, re.I):
                problems.append(f"{name}:{line_no}  spell test counts with digits so they can be checked\n    {line.strip()[:120]}")

    print(f"backend tests: {backend}")
    print(f"browser checks: {checks if checks is not None else 'unknown (run tests/e2e/run.py first)'}"
          f"{f' across {suites} suites' if suites else ''}")
    print(f"extension version: {version}")
    if checks is None:
        print("\nNote: browser-suite claims were not checked, because tests/e2e/run.py has not been run here.")

    if problems:
        print(f"\n{len(problems)} stale claim(s):\n")
        for p in problems:
            print(f"  {p}")
        return 1
    print("\nEvery documented figure matches the repo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
