use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve app data dir: {error}"))?;

    fs::create_dir_all(&dir).map_err(|error| format!("Cannot create app data dir: {error}"))?;
    Ok(dir)
}

#[tauri::command]
fn app_data_path(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn save_note(app: AppHandle, json: String) -> Result<(), String> {
    let path = data_dir(&app)?.join("note.json");
    fs::write(&path, json).map_err(|e| format!("Cannot save note: {e}"))?;
    Ok(())
}

#[tauri::command]
fn load_note(app: AppHandle) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join("note.json");
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path).map_err(|e| format!("Cannot load note: {e}"))?;
    Ok(Some(content))
}

#[tauri::command]
fn write_markdown_file(path: String, content: String) -> Result<String, String> {
    fs::write(&path, content).map_err(|error| format!("Cannot export note: {error}"))?;
    Ok(path)
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            app_data_path,
            save_note,
            load_note,
            write_markdown_file,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
