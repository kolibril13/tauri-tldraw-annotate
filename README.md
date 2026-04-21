# Quick Screenshot Annotator

```
bun run tauri dev
bun run tauri build
python3 scripts/copy_release_to_downloads.py

```

A minimal desktop app for quickly annotating screenshots. Paste a screenshot from
the clipboard, scribble on top of it with [tldraw](https://tldraw.dev), and export
the result as PNG, JPEG, or WebP. All processing happens locally — nothing is
uploaded or stored.

Built with [Tauri 2](https://tauri.app), React 19, Vite, and tldraw.

## Features

- Paste screenshots via toolbar button or <kbd>Cmd/Ctrl</kbd> + <kbd>V</kbd>
- Draw / annotate with the full tldraw toolset (defaults to orange, XL brush)
- Auto-adds directional pointer emojis (👆👈👉👇) next to the image for easy callouts
- Optional 2× downscale prompt for high-res screenshots (height > 1000px)
- Preview mode (flattened tldraw render) before exporting
- Export as JPEG / PNG / WebP at the original image dimensions

## Project layout

```
src/            React frontend (UI + tldraw integration)
src-tauri/      Rust/Tauri shell, bundler config, icons
scripts/        Dev/release helper scripts
```

Key files:

- `src/components/ScreenshotAnnotator.tsx` — the main annotator component
- `src-tauri/tauri.conf.json` — window config, dev/build commands, bundle targets
- `src-tauri/src/lib.rs` — Tauri app entrypoint

## Prerequisites

- [Bun](https://bun.sh) (used by `beforeDevCommand` / `beforeBuildCommand` in
  `tauri.conf.json`)
- [Rust toolchain](https://www.rust-lang.org/tools/install) (`rustup`, stable)
- Platform prerequisites for Tauri — see
  [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
  (on macOS: Xcode Command Line Tools)

## Install

```bash
bun install
```

## Build

Production build — compiles the frontend with Vite, then bundles the Tauri app
(`.app` + `.dmg` on macOS, `.msi` on Windows, `.deb`/`.AppImage` on Linux):

```bash
bun run tauri build
```

Artifacts land under `src-tauri/target/release/bundle/`. To copy the newest
macOS artifact to `~/Downloads`:

```bash
python3 scripts/copy_release_to_downloads.py
# optional flags:
#   --kind dmg|app|auto     (default: auto, newest of the two)
#   --dest ~/Desktop        (default: ~/Downloads)
```

Frontend-only build (no native bundle):

```bash
bun run build        # tsc + vite build → dist/
bun run preview      # serve dist/ for sanity-checking
```

## Develop / hot reload

Run the Tauri dev shell. This starts Vite on `http://localhost:1420` (see
`devUrl` in `tauri.conf.json`) and launches the native window pointed at it,
with hot reload for the React code:

```bash
bun run tauri dev
```

Edits to files under `src/` hot-reload automatically via Vite HMR.

Edits to Rust code under `src-tauri/src/` trigger a rebuild + window restart
(Tauri watches the crate by default).

To iterate on the frontend only in a regular browser (no Tauri APIs such as
`@tauri-apps/plugin-clipboard-manager` available — browser clipboard fallback
is used instead):

```bash
bun run dev          # http://localhost:1420
```

## Debug

**Frontend (WebView):** right-click inside the app window → *Inspect Element*
to open devtools. This works in `tauri dev` builds by default; for release
builds, set `"withGlobalTauri": true` / enable devtools in `tauri.conf.json`
as needed.

**Rust side:** `bun run tauri dev` streams `println!` / `tracing` / panic
output to the terminal where you launched it. For more verbose logs:

```bash
RUST_LOG=debug bun run tauri dev
RUST_BACKTRACE=1 bun run tauri dev     # full backtrace on panics
```

**Clipboard issues:** the app uses `@tauri-apps/plugin-clipboard-manager` when
running inside Tauri (detected via `__TAURI_INTERNALS__`) and falls back to the
browser `navigator.clipboard` API otherwise. If paste silently fails in the
packaged app, check the capabilities in `src-tauri/capabilities/`.

**Clean rebuild** when things get weird:

```bash
rm -rf dist src-tauri/target node_modules
bun install
bun run tauri dev
```
