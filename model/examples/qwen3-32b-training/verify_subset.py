#!/usr/bin/env python3
"""Integrity check for this slimmed training snapshot (stdlib only).

Reads source-manifest.json and verifies:
  1. every file marked `copied` is present and byte-identical to the recorded
     source SHA-256;
  2. every file marked `sampled` matches its recorded sample SHA-256 (the SHA
     of the full original is also recorded for off-repo comparison);
  3. every file marked `omitted` is genuinely absent from this tree;
  4. no unlisted stray file exists in this tree;
  5. the agentic release split under ../../data/releases matches the recorded
     row counts and SHA-256 values.

This is NOT the full byte-frozen bundle verification: scripts/verify_bundle.py
requires the omitted files to be restored first (see source-manifest.json and
README.md).
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    manifest = json.loads((ROOT / "source-manifest.json").read_text(encoding="utf-8"))
    errors: list[str] = []
    counts = {"copied": 0, "sampled": 0, "omitted": 0, "authored": 0, "superseded": 0}

    listed: set[str] = {"source-manifest.json"}
    for entry in manifest["files"]:
        rel = entry["file"]
        listed.add(rel)
        path = ROOT / rel
        status = entry["status"]
        if status in counts:
            counts[status] += 1
        if status == "copied":
            if not path.is_file():
                errors.append(f"missing copied file: {rel}")
            elif sha256(path) != entry["sha256"]:
                errors.append(f"SHA-256 mismatch vs frozen source: {rel}")
        elif status == "sampled":
            if not path.is_file():
                errors.append(f"missing sampled file: {rel}")
            elif sha256(path) != entry["sample_sha256"]:
                errors.append(f"SHA-256 mismatch vs recorded sample: {rel}")
        elif status == "omitted":
            if path.exists():
                errors.append(f"file marked omitted but present: {rel}")
        elif status == "superseded":
            pass  # path is owned by another (authored) entry; only the origin SHA is recorded
        elif status == "authored":
            if not path.is_file():
                errors.append(f"missing authored file: {rel}")
            elif sha256(path) != entry["sha256"]:
                errors.append(f"SHA-256 mismatch for authored file: {rel}")
        else:
            errors.append(f"unknown status {status!r} for {rel}")

    for path in sorted(ROOT.rglob("*")):
        if path.is_file():
            rel = str(path.relative_to(ROOT))
            if rel not in listed and not rel.endswith(".DS_Store"):
                errors.append(f"unlisted stray file: {rel}")

    release = manifest.get("data_release", {})
    release_root = (ROOT / release.get("path", "")).resolve() if release else None
    for item in release.get("files", []):
        path = release_root / item["file"]
        if not path.is_file():
            errors.append(f"missing release file: {item['file']}")
            continue
        if sha256(path) != item["sha256"]:
            errors.append(f"release SHA-256 mismatch: {item['file']}")
        rows = sum(1 for line in path.open("rb") if line.strip())
        if rows != item["rows"]:
            errors.append(f"release row-count mismatch: {item['file']} ({rows} != {item['rows']})")

    report = {
        "schema_version": "qwen3_training_subset_verification.v1",
        "valid": not errors,
        "counts": counts,
        "release_files_checked": len(release.get("files", [])),
        "errors": errors,
    }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
