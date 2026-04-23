use std::path::{Path, PathBuf};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

// Expand a leading `~` or `~/…` to the user's home directory.
fn expand_tilde(input: &str) -> PathBuf {
    let trimmed = input.trim();
    if trimmed == "~" {
        return dirs_home();
    }
    if let Some(rest) = trimmed.strip_prefix("~/") {
        let mut home = dirs_home();
        home.push(rest);
        return home;
    }
    PathBuf::from(trimmed)
}

fn dirs_home() -> PathBuf {
    // std::env::home_dir is deprecated but fine for our desktop-only use case;
    // prefer $HOME on unix and %USERPROFILE% on windows.
    #[cfg(windows)]
    {
        if let Ok(p) = std::env::var("USERPROFILE") {
            return PathBuf::from(p);
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(p) = std::env::var("HOME") {
            return PathBuf::from(p);
        }
    }
    PathBuf::from(".")
}

/// Capture a screenshot using the built-in macOS `screencapture` tool.
///
/// Works for two flows:
///   * **Launch flow** – the window starts hidden (`visible: false` in
///     `tauri.conf.json`); we run the selection UI first, then reveal the
///     window with the shot loaded.
///   * **In-app flow** – the window is visible; we hide it, capture, then
///     bring it back.
///
/// In both cases the window is shown + focused at the end regardless of
/// outcome, so the user is never stuck staring at a hidden window. Returns
/// the sentinel `"cancelled"` if the user aborts with Esc so the frontend
/// can treat that as a no-op.
#[cfg(target_os = "macos")]
#[tauri::command]
async fn capture_screenshot(window: tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    use std::process::Command;
    use std::time::{SystemTime, UNIX_EPOCH};

    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp = std::env::temp_dir().join(format!(
        "curate-draw-{}-{}.png",
        std::process::id(),
        stamp
    ));

    let was_visible = window.is_visible().unwrap_or(false);
    if was_visible {
        let _ = window.hide();
        // Give macOS a moment to actually hide the window before the
        // selection overlay appears, otherwise it can show up in the shot.
        std::thread::sleep(std::time::Duration::from_millis(200));
    }

    let status = Command::new("/usr/sbin/screencapture")
        .arg("-i") // interactive selection
        .arg("-x") // silent (no shutter sound)
        .arg(&tmp)
        .status();

    // Always reveal the window afterwards – success, cancel, or error.
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();

    let status = status.map_err(|e| format!("Failed to launch screencapture: {}", e))?;
    if !status.success() {
        // A non-zero exit with no output file almost always means Screen Recording
        // permission was denied. Open System Settings directly so the user can grant it.
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture")
            .spawn();
        return Err("permission_denied".to_string());
    }
    if !tmp.exists() {
        return Err("cancelled".to_string());
    }

    let bytes = std::fs::read(&tmp).map_err(|e| format!("Could not read captured image: {}", e))?;
    let _ = std::fs::remove_file(&tmp);
    Ok(bytes)
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
async fn capture_screenshot(_window: tauri::WebviewWindow) -> Result<Vec<u8>, String> {
    Err("Screenshot capture is only supported on macOS.".to_string())
}

#[tauri::command]
fn save_image_to_folder(
    folder: String,
    filename: String,
    bytes: Vec<u8>,
) -> Result<String, String> {
    if folder.trim().is_empty() {
        return Err("Output folder is empty.".to_string());
    }
    if filename.trim().is_empty() {
        return Err("Filename is empty.".to_string());
    }
    // Disallow path separators in the filename to keep writes inside `folder`.
    if filename.contains('/') || filename.contains('\\') {
        return Err("Filename must not contain path separators.".to_string());
    }

    let folder_path = expand_tilde(&folder);

    if !folder_path.exists() {
        std::fs::create_dir_all(&folder_path)
            .map_err(|e| format!("Could not create folder: {}", e))?;
    } else if !folder_path.is_dir() {
        return Err(format!(
            "Path exists but is not a directory: {}",
            folder_path.display()
        ));
    }

    let full_path: PathBuf = Path::new(&folder_path).join(&filename);
    std::fs::write(&full_path, &bytes).map_err(|e| format!("Could not write file: {}", e))?;

    Ok(full_path.to_string_lossy().to_string())
}

#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let path = expand_tilde(&path);
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Could not read file: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            save_image_to_folder,
            capture_screenshot,
            read_text_file,
            quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
