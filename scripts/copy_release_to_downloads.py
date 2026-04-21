# #!/usr/bin/env python3
"""Copy the latest Tauri release build to ~/Downloads.

Looks for the most recently built artifact under
`src-tauri/target/release/bundle/` (preferring `.dmg`, then `.app`) and
copies it into the user's Downloads folder.

Usage:
    python3 scripts/copy_release_to_downloads.py
    python3 scripts/copy_release_to_downloads.py --kind app
    python3 scripts/copy_release_to_downloads.py --dest ~/Desktop
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BUNDLE_DIR = PROJECT_ROOT / "src-tauri" / "target" / "release" / "bundle"

KIND_GLOBS: dict[str, list[str]] = {
    "dmg": ["dmg/*.dmg"],
    "app": ["macos/*.app"],
    "auto": ["dmg/*.dmg", "macos/*.app"],
}


def find_latest(kind: str) -> Path | None:
    if not BUNDLE_DIR.is_dir():
        return None
    candidates: list[Path] = []
    for pattern in KIND_GLOBS[kind]:
        candidates.extend(BUNDLE_DIR.glob(pattern))
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def copy_to(src: Path, dest_dir: Path) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    target = dest_dir / src.name
    if target.exists():
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    if src.is_dir():
        shutil.copytree(src, target, symlinks=True)
    else:
        shutil.copy2(src, target)
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--kind",
        choices=list(KIND_GLOBS),
        default="auto",
        help="Which artifact to copy (default: auto → newest of dmg/app).",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=Path.home() / "Downloads",
        help="Destination directory (default: ~/Downloads).",
    )
    args = parser.parse_args()

    artifact = find_latest(args.kind)
    if artifact is None:
        print(
            f"No release artifact found under {BUNDLE_DIR}.\n"
            "Run `bun run tauri build` first.",
            file=sys.stderr,
        )
        return 1

    dest_dir = args.dest.expanduser().resolve()
    copied = copy_to(artifact, dest_dir)

    size_mb = (
        sum(f.stat().st_size for f in copied.rglob("*") if f.is_file())
        if copied.is_dir()
        else copied.stat().st_size
    ) / (1024 * 1024)

    print(f"Copied {artifact.relative_to(PROJECT_ROOT)} → {copied} ({size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
