#!/usr/bin/env python3
"""Fail if a credential is in the tree.

A secret can leak in two ways, so there are two checks:

  1. **Contents** - a private key, API key or token pasted into a file.
  2. **Filename** - a credential file committed by accident (`.env`, a service-account JSON).

Usage:
    python3 scripts/check-secrets.py            # every file git tracks (what CI runs)
    python3 scripts/check-secrets.py --staged    # only what is staged (the pre-commit hook)
    python3 scripts/check-secrets.py --tree      # every file on disk, tracked or not (advisory)

The content rules are deliberately narrow. This codebase legitimately *mentions* credentials: the FCM
form prints `-----BEGIN PRIVATE KEY-----` as placeholder text, `Code.gs` lists settings keys like
`fcm_service_account_private_key`, and the setup guide explains `client_email` in prose. A bare keyword
search would fail on a clean tree, so every rule requires a VALUE rather than a name.

Exit code 1 on a finding, 0 otherwise, so it can gate a commit or a build.
"""
import re
import subprocess
import sys

# --- what a secret looks like -------------------------------------------------
#
# Kept precise on purpose: each pattern needs the shape of real key material, not just a name.
CONTENT_RULES = [
    (
        "a PEM private key",
        # The header alone is not enough: it is used as placeholder text in the admin UI. A real key has a
        # long base64 body after it, wrapped across lines - hence whitespace inside the character class.
        re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\sA-Za-z0-9+/=]{100,}"),
    ),
    ("a Google API key", re.compile(r"AIza[0-9A-Za-z_\-]{30,}")),
    (
        "a service-account field with a value",
        # A JSON *key with a value*, so the field names in Code.gs comments and the setup guide are fine.
        re.compile(r'"(private_key|private_key_id|client_email|client_id)"\s*:\s*"'),
    ),
    ("a GitHub token", re.compile(r"gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}")),
    ("a Slack token", re.compile(r"xox[baprs]-[A-Za-z0-9-]{10,}")),
]

# Files that must never be tracked, whatever they contain. `.env.example` is the whole point of an example,
# so it is exempt.
#
# The `-<digits>.json` arm matches the filename Firebase uses when you download a service-account key
# (`<project-id>-<number>.json`, e.g. fire-clock-76723.json), so a key from any project is caught rather than
# just the one this repo happens to have used.
SENSITIVE_PATH = re.compile(
    r"(^|/)(\.env(\.[A-Za-z0-9]+)?$|\.env\.local$|[^/]*service[_-]?account[^/]*\.json$|[^/]*-[0-9]{5,}\.json$)",
    re.IGNORECASE,
)
PATH_EXEMPT = re.compile(r"\.env\.example$", re.IGNORECASE)

SKIP_PREFIXES = ("node_modules/", "dist/", "tmp-test-out/", ".git/")


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, check=False).stdout.split("\n")


def files_to_check(mode):
    if mode == "--staged":
        paths = [p for p in git("diff", "--cached", "--name-only", "--diff-filter=ACM") if p]
    else:
        paths = [p for p in git("ls-files") if p]
        if mode == "--tree":
            paths = [
                p
                for p in git("ls-files", "--cached", "--others", "--exclude-standard")
                if p
            ]
    return [p for p in paths if p and not p.startswith(SKIP_PREFIXES)]


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--tracked"
    paths = files_to_check(mode)
    findings = []

    for path in paths:
        if SENSITIVE_PATH.search(path) and not PATH_EXEMPT.search(path):
            findings.append((path, 0, f"a credential file that should not be committed ({path})"))
            continue

        if path.endswith((".png", ".jpg", ".jpeg", ".ico", ".wav", ".mp3", ".webmanifest", ".pxd")):
            continue

        try:
            with open(path, encoding="utf-8", errors="ignore") as handle:
                text = handle.read()
        except (OSError, UnicodeDecodeError):
            continue

        # Scanned as a whole rather than line by line: a PEM key is wrapped across many lines, so a
        # per-line search could never match one. The line number is derived from the match offset instead.
        for label, pattern in CONTENT_RULES:
            for match in pattern.finditer(text):
                number = text.count("\n", 0, match.start()) + 1
                findings.append((path, number, label))

    if findings:
        print("Credential found in the repository:\n")
        for path, number, label in findings:
            where = f"{path}:{number}" if number else path
            print(f"  {where}  ->  {label}")
        print(
            "\nRemove it, and ROTATE the key. Removing it from a later commit does not unpublish it: the "
            "commit stays reachable by SHA and every clone keeps its copy."
        )
        return 1

    print(f"ok  no credentials in {len(paths)} file(s) ({mode})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
