---
name: release-pipeline
description: How to cut and publish a new curate-draw release — build, sign, notarize, and put a versioned download on the jan-hendrik-mueller.de website. Use when asked to release, ship, publish, or bump the version of curate-draw.
---

# Curate Draw release pipeline

One command builds, notarizes, and publishes a new version to the website:

```bash
bun run release
```

That expands to `bun tauri build --bundles app && node scripts/publish-release.mjs`.

## What happens, in order

1. **Bump the version first.** Edit `package.json` `"version"` (e.g. `0.1.4` → `0.1.5`).
   `src-tauri/tauri.conf.json` reads `version` from `../package.json`, so the app
   bundle reports it automatically — no second place to edit.
2. **`tauri build --bundles app`** compiles the Vite frontend + Rust binary in
   release mode, bundles `curate-draw.app`, code-signs it with the
   *Developer ID Application* identity, **notarizes** it with Apple, and **staples**
   the ticket into the `.app`.
3. **`scripts/publish-release.mjs`** then:
   - `ditto`-zips the notarized `.app` to
     `…/jan-hendrik-mueller.de/public/curate-draw-<version>.zip`
     (ditto preserves the stapled ticket and resource forks).
   - copies it to `curate-draw.zip` (an unversioned "latest" alias kept for any
     old direct links).
   - regenerates `public/curate-draw-versions.json` by **scanning** every
     `curate-draw-*.zip` in the public dir — version from filename, size + date
     from the file itself, semver-sorted descending. The manifest is therefore
     always consistent with the zips actually present; to remove a version,
     delete its zip and re-run.

## Prerequisites (notarization)

- **Apple Developer Program License Agreement must be in-effect.** If it has
  lapsed or was updated, notarization fails with `HTTP 403: A required agreement
  is missing or has expired`. Fix at developer.apple.com → Account → Agreements,
  signed in as the **Account Holder**. Propagation to the notary service can take
  a few minutes; verify with:
  ```bash
  xcrun notarytool history --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID"
  ```
- Credentials come from env vars: `APPLE_ID`, `APPLE_PASSWORD` (an app-specific
  password), `APPLE_TEAM_ID` (`D97HVFC4GT`). The signing identity is set in
  `src-tauri/tauri.conf.json` under `bundle.macOS.signingIdentity`.

## How the website serves it

`jan-hendrik-mueller.de` is a static Astro site. The page
`src/pages/tools/curate-draw.astro` reads `public/curate-draw-versions.json` **at
build time** and renders:
- the hero version badge + a prominent **latest** download button → `/curate-draw-<latest>.zip`
- a collapsible **Previous versions** list (everything except latest) with date + size.

There is no runtime fetching — these are static `<a download>` links to files in
`public/`.

## Deploying

The site deploys when you push the website repo to `origin/main`
(`kolibril13/jan-hendrik-mueller.de`); the host rebuilds the Astro site. So a full
release is:

1. `bun run release` in this repo (builds + publishes artifacts into the website's `public/`).
2. Commit + push **this** repo (version bump + any code changes).
3. Commit + push the **website** repo (new zip, updated manifest, page changes) → triggers deploy.

Verify the website build before pushing: `npm run build` in the website repo, then
check `dist/tools/curate-draw/index.html` links to the new `curate-draw-<version>.zip`.

## Gotchas

- Each release commits a ~5.7 MB zip into the website git history (all versions are
  kept). If history bloat becomes a problem, switch to git LFS or prune old zips.
- Don't hand-edit `curate-draw-versions.json` — it's regenerated from the zips on
  every `bun run release`.
