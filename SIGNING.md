# Apple Developer Signing Setup

Once you have your Apple Developer Program membership, ask Claude to do the following:

---

## What to remove (unsigned workarounds)

### 1. Delete `build.sh`

The `build.sh` script at the project root exists only to work around the permission-reset
problem with unsigned builds. With a signed app, macOS tracks permissions by Team ID, so
they survive rebuilds. Delete the file and use `npm run tauri build` directly.

### 2. Remove the `tccutil` workaround from `lib.rs`

In `src-tauri/src/lib.rs`, inside `capture_screenshot`, replace:

```rust
if !status.success() {
    // A non-zero exit with no output file almost always means Screen Recording
    // permission was denied. Open System Settings directly so the user can grant it.
    let _ = Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
        .spawn();
    return Err("permission_denied".to_string());
}
```

with the original simple error:

```rust
if !status.success() {
    return Err(format!("screencapture exited with status {}", status));
}
```

### 3. Remove the `permission_denied` handler from `ScreenshotAnnotator.tsx`

In `src/components/ScreenshotAnnotator.tsx`, inside `captureScreenshot`, remove:

```typescript
if (message === 'permission_denied') {
    setStatus('Screen Recording permission required — System Settings opened, grant access and try again.');
    return;
}
```

---

## What to set up (signing)

### 4. Configure signing in `src-tauri/tauri.conf.json`

Add under the `bundle` section:

```json
"macOS": {
  "signingIdentity": "Developer ID Application: YOUR NAME (TEAMID)",
  "providerShortName": "TEAMID",
  "entitlements": "entitlements.plist"
}
```

### 5. Create `src-tauri/entitlements.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.security.screen-recording</key>
    <true/>
</dict>
</plist>
```

### 6. Set environment variables for notarization (optional, for distribution)

```bash
export APPLE_ID="your@apple.id"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
```

---

After completing the above, a plain `npm run tauri build` will produce a fully signed and
(optionally notarized) app that retains Screen Recording permission across rebuilds.
