from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / ".github" / "workflows"
FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
USES_LINE = re.compile(r"^\s*-?\s*uses:\s*([^\s#]+)")

SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("Supabase secret key", re.compile(r"\bsb_secret_[A-Za-z0-9_-]{20,}\b")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("AWS access key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("private key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----")),
)

ALLOWED_PLACEHOLDERS = (
    "sb_secret_REPLACE_ME",
    "sb_publishable_REPLACE_ME",
    "sb_publishable_ci_placeholder",
)

SKIP_SUFFIXES = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".docx", ".pptx", ".xlsx",
    ".zip", ".gz", ".tar", ".woff", ".woff2", ".ttf", ".ico", ".lock",
}


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
    )
    return [ROOT / item.decode("utf-8") for item in result.stdout.split(b"\0") if item]


def check_actions_are_immutable(errors: list[str]) -> None:
    for workflow in sorted(WORKFLOW_DIR.glob("*.y*ml")):
        text = workflow.read_text(encoding="utf-8")
        if "${{ secrets." in text:
            errors.append(f"{workflow.relative_to(ROOT)} references GitHub secrets; PR CI must remain secretless")
        for line_number, line in enumerate(text.splitlines(), start=1):
            match = USES_LINE.match(line)
            if not match:
                continue
            ref = match.group(1)
            if ref.startswith("./"):
                continue
            if "@" not in ref:
                errors.append(f"{workflow.relative_to(ROOT)}:{line_number} action has no immutable ref: {ref}")
                continue
            action, revision = ref.rsplit("@", 1)
            if not FULL_SHA.fullmatch(revision):
                errors.append(
                    f"{workflow.relative_to(ROOT)}:{line_number} {action} must be pinned to a full 40-char commit SHA"
                )


def check_tracked_secrets(errors: list[str]) -> None:
    for path in tracked_files():
        if path.suffix.lower() in SKIP_SUFFIXES or not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        sanitized = text
        for placeholder in ALLOWED_PLACEHOLDERS:
            sanitized = sanitized.replace(placeholder, "")
        for label, pattern in SECRET_PATTERNS:
            if pattern.search(sanitized):
                errors.append(f"{path.relative_to(ROOT)} contains a value matching the {label} pattern")


def main() -> int:
    errors: list[str] = []
    check_actions_are_immutable(errors)
    check_tracked_secrets(errors)
    if errors:
        print("Security policy violations detected:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    print("Security policy checks passed: immutable actions, secretless PR workflows, no high-risk tracked secret patterns.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
