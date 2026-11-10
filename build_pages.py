#!/usr/bin/env python3
"""Create a public-only, project-path-safe GitHub Pages artifact."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
BUILD = ROOT / ".pages-build"

# This allowlist is the publication boundary. Do not replace it with a recursive
# copy of the project or rely on .gitignore to keep private source files out.
PUBLIC_FILES = (
    "index.html",
    "statistics.html",
    "preliminary.html",
    "group-a.html",
    "group-b.html",
    "race-details.html",
    "standings.html",  # legacy bookmark redirect to the homepage
    "styles.css",
    "site-config.js",
    "dashboard-core.js",
    "app.js",
    "data/penrose-stats.json",
    "assets/penrose-cup.png",
    "assets/penrose-cup-banner.png",
    "assets/penrose-cup-prize-breakdown.png",
)

PRIVATE_KEY_NAMES = {
    "driverid", "driver_id", "eventid", "event_id", "sessionid", "session_id",
    "participantid", "participant_id", "accountid", "account_id", "discordid",
    "discord_id", "email", "password", "secret", "token", "databasepath",
    "database_path", "sourcepath", "source_path", "sqlitepath", "sqlite_path",
}
SENSITIVE_VALUE_PATTERNS = (
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    re.compile(r"\b[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12}\b"),
    re.compile(r"(?i)(?:[A-Z]:\\|/Users/|/home/|\.sqlite\b|\.sqlite3\b)"),
)


def audit_public_json(value: object, trail: str = "") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = str(key).replace("-", "").lower()
            if normalized in PRIVATE_KEY_NAMES:
                raise ValueError(f"private-looking field in public JSON: {trail}.{key}")
            audit_public_json(child, f"{trail}.{key}" if trail else str(key))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            audit_public_json(child, f"{trail}[{index}]")
    elif isinstance(value, str):
        for pattern in SENSITIVE_VALUE_PATTERNS:
            if pattern.search(value):
                raise ValueError(f"private-looking value in public JSON: {trail}")


def public_data_copy() -> bytes:
    source = PUBLIC / "data/penrose-stats.json"
    data = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("nextRace"), dict):
        raise ValueError("statistics JSON is missing the expected top-level structure")

    # Game version is a fixed website label, not Race Director event data.
    # Drop the legacy captured value (F1 25) from the browser payload.
    data["nextRace"].pop("game", None)
    audit_public_json(data)
    return (json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def check_local_references(build: Path) -> None:
    html_reference = re.compile(r"\b(?:href|src)=['\"]([^'\"]+)['\"]", re.IGNORECASE)
    for html_path in build.glob("*.html"):
        markup = html_path.read_text(encoding="utf-8")
        for raw in html_reference.findall(markup):
            reference = raw.split("#", 1)[0].split("?", 1)[0]
            if not reference or reference.startswith(("https://", "http://", "mailto:", "tel:", "data:")):
                continue
            if reference.startswith("/"):
                raise ValueError(f"root-absolute URL breaks the GitHub Pages project path: {html_path.name}: {raw}")
            target = (build / html_path.parent / reference).resolve()
            if build.resolve() not in target.parents and target != build.resolve():
                raise ValueError(f"page reference escapes the publication directory: {html_path.name}: {raw}")
            if not target.is_file():
                raise ValueError(f"missing local page asset: {html_path.name}: {raw}")

    css = (build / "styles.css").read_text(encoding="utf-8")
    for raw in re.findall(r"url\([\"']?([^\"')]+)", css):
        reference = raw.split("?", 1)[0]
        if reference.startswith(("https://", "http://", "data:")):
            continue
        if reference.startswith("/") or not (build / reference).is_file():
            raise ValueError(f"missing or project-path-incompatible CSS asset: {raw}")


def build() -> list[str]:
    if BUILD.is_symlink():
        raise ValueError(f"refusing to replace symlinked build directory: {BUILD}")

    sources = [PUBLIC / item for item in PUBLIC_FILES]
    missing = [item for item, source in zip(PUBLIC_FILES, sources) if not source.is_file() or source.is_symlink()]
    if missing:
        raise ValueError("missing or symlinked allowlisted source file(s): " + ", ".join(missing))

    data_bytes = public_data_copy()
    data_hash = hashlib.sha256(data_bytes).hexdigest()[:16]
    temp = ROOT / ".pages-build.tmp"
    if temp.is_symlink():
        raise ValueError(f"refusing to replace symlinked temporary build directory: {temp}")
    if temp.exists():
        shutil.rmtree(temp)
    temp.mkdir()

    try:
        for relative, source in zip(PUBLIC_FILES, sources):
            destination = temp / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if relative == "data/penrose-stats.json":
                destination.write_bytes(data_bytes)
            else:
                shutil.copyfile(source, destination)

        app_path = temp / "app.js"
        app_text = app_path.read_text(encoding="utf-8")
        app_text, replacements = re.subn(
            r'(const DATA_URL = "data/penrose-stats\.json\?v=)[^\"]+(";)',
            rf"\g<1>{data_hash}\g<2>",
            app_text,
            count=1,
        )
        if replacements != 1:
            raise ValueError("could not locate the statistics JSON URL for content-versioning")
        app_path.write_text(app_text, encoding="utf-8")

        # Version page assets by content so manual public updates do not reuse
        # stale browser/CDN copies after a GitHub Pages deployment.
        for html_path in temp.glob("*.html"):
            markup = html_path.read_text(encoding="utf-8")
            for asset in ("styles.css", "site-config.js", "dashboard-core.js", "app.js"):
                digest = hashlib.sha256((temp / asset).read_bytes()).hexdigest()[:12]
                markup = re.sub(
                    rf'((?:href|src)=["\']){re.escape(asset)}(?:\?v=[^"\']*)?(["\'])',
                    rf"\g<1>{asset}?v={digest}\g<2>",
                    markup,
                )
            html_path.write_text(markup, encoding="utf-8")

        # Keep deterministic sorting and verify the artifact has no surprises.
        actual = sorted(path.relative_to(temp).as_posix() for path in temp.rglob("*") if path.is_file())
        expected = sorted(PUBLIC_FILES)
        if actual != expected:
            raise ValueError(f"publication contents do not match the allowlist: {actual}")
        if any("admin" in item.lower() or ".private-data" in item.lower() for item in actual):
            raise ValueError("private Admin or snapshot path found in publication artifact")
        for path in temp.rglob("*"):
            if path.is_file() and path.suffix.lower() in {".html", ".js", ".css", ".json"}:
                body = path.read_text(encoding="utf-8")
                if re.search(r"(?i)(?:/admin/|group-b-compliance|local_preview\.py|\.private-data|\.sqlite\b)", body):
                    raise ValueError(f"private project reference found in publication file: {path.relative_to(temp)}")
        check_local_references(temp)

        if BUILD.exists():
            if not BUILD.is_dir():
                raise ValueError(f"refusing to replace non-directory build path: {BUILD}")
            shutil.rmtree(BUILD)
        temp.replace(BUILD)
        return actual
    except Exception:
        if temp.exists():
            shutil.rmtree(temp)
        raise


if __name__ == "__main__":
    try:
        files = build()
    except Exception as exc:
        print(f"Pages build failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
    print(f"Prepared {len(files)} public files in {BUILD.relative_to(ROOT)}/")
    print("\n".join(files))
