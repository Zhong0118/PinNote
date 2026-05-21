use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;
use tauri::{
    image::Image,
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

struct NotesFileLock(Mutex<()>);

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Cannot resolve app data dir: {error}"))?;

    fs::create_dir_all(&dir).map_err(|error| format!("Cannot create app data dir: {error}"))?;
    Ok(dir)
}

fn data_file(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join(name))
}

fn atomic_write(path: PathBuf, content: String) -> Result<(), String> {
    let tmp_path = path.with_extension("tmp");
    fs::write(&tmp_path, content).map_err(|e| format!("Cannot write temp file: {e}"))?;
    if let Err(error) = fs::rename(&tmp_path, &path) {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| format!("Cannot remove old file: {e}"))?;
            fs::rename(&tmp_path, &path).map_err(|e| format!("Cannot replace file: {e}"))?;
        } else {
            return Err(format!("Cannot replace file: {error}"));
        }
    }
    Ok(())
}

fn read_optional(path: PathBuf) -> Result<Option<String>, String> {
    if !path.exists() {
        return Ok(None);
    }

    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Cannot read file: {e}"))
}

fn load_notes_value(app: &AppHandle) -> Result<Value, String> {
    let path = data_file(app, "notes.json")?;
    let Some(raw) = read_optional(path)? else {
        return Ok(serde_json::json!({
            "version": 1,
            "lastActiveNoteId": "",
            "lastClosedNoteId": "",
            "notes": {}
        }));
    };

    serde_json::from_str(&raw).map_err(|e| format!("Cannot parse notes file: {e}"))
}

fn save_notes_value(app: &AppHandle, file: Value) -> Result<(), String> {
    atomic_write(data_file(app, "notes.json")?, file.to_string())
}

fn ensure_notes_object(file: &mut Value) {
    file["version"] = Value::from(1);
    if !file.get("notes").is_some_and(Value::is_object) {
        file["notes"] = serde_json::json!({});
    }
}

fn merge_json(target: &mut Value, patch: &Value) {
    match (target, patch) {
        (Value::Object(target), Value::Object(patch)) => {
            for (key, value) in patch {
                merge_json(target.entry(key.clone()).or_insert(Value::Null), value);
            }
        }
        (target, patch) => {
            *target = patch.clone();
        }
    }
}

fn note_id(note: &Value) -> Result<String, String> {
    note.get("id")
        .and_then(Value::as_str)
        .map(ToString::to_string)
        .ok_or_else(|| "Note id is missing".to_string())
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("show", "显示最近便签")
        .text("new_note", "新建便签")
        .text("settings", "设置")
        .separator()
        .text("quit", "退出")
        .build()?;

    let icon = app
        .default_window_icon()
        .cloned()
        .unwrap_or_else(|| Image::new(&[], 0, 0));

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .tooltip("PinNote")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = tray.app_handle().emit("show-last-note-requested", ());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                let _ = app.emit("show-last-note-requested", ());
            }
            "new_note" => {
                show_main_window(app);
                let _ = app.emit("new-note-requested", ());
            }
            "settings" => {
                show_main_window(app);
                let _ = app.emit("open-settings-requested", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)?;

    Ok(())
}

#[tauri::command]
fn app_data_path(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
fn load_note(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(data_file(&app, "note.json")?)
}

#[tauri::command]
fn save_notes(app: AppHandle, json: String) -> Result<(), String> {
    atomic_write(data_file(&app, "notes.json")?, json)
}

#[tauri::command]
fn load_notes(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(data_file(&app, "notes.json")?)
}

#[tauri::command]
fn upsert_note(
    app: AppHandle,
    lock: tauri::State<'_, NotesFileLock>,
    json: String,
    set_active: bool,
    set_closed: bool,
) -> Result<String, String> {
    let _guard = lock.0.lock().map_err(|_| "Cannot lock notes file".to_string())?;
    let note: Value = serde_json::from_str(&json).map_err(|e| format!("Cannot parse note: {e}"))?;
    let id = note_id(&note)?;
    let mut file = load_notes_value(&app)?;
    ensure_notes_object(&mut file);
    file["notes"][&id] = note.clone();
    if set_active {
        file["lastActiveNoteId"] = Value::from(id.clone());
    }
    if set_closed {
        file["lastClosedNoteId"] = Value::from(id.clone());
    }
    save_notes_value(&app, file)?;
    Ok(note.to_string())
}

#[tauri::command]
fn patch_note(
    app: AppHandle,
    lock: tauri::State<'_, NotesFileLock>,
    id: String,
    json: String,
    set_active: bool,
    set_closed: bool,
) -> Result<String, String> {
    let _guard = lock.0.lock().map_err(|_| "Cannot lock notes file".to_string())?;
    let patch: Value = serde_json::from_str(&json).map_err(|e| format!("Cannot parse note patch: {e}"))?;
    let mut file = load_notes_value(&app)?;
    ensure_notes_object(&mut file);
    let target = &mut file["notes"][&id];
    merge_json(target, &patch);
    target["id"] = Value::from(id.clone());
    if set_active {
        file["lastActiveNoteId"] = Value::from(id.clone());
    }
    if set_closed {
        file["lastClosedNoteId"] = Value::from(id.clone());
    }
    let note = file["notes"][&id].clone();
    save_notes_value(&app, file)?;
    Ok(note.to_string())
}

#[tauri::command]
fn save_settings(app: AppHandle, json: String) -> Result<(), String> {
    atomic_write(data_file(&app, "settings.json")?, json)
}

#[tauri::command]
fn load_settings(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(data_file(&app, "settings.json")?)
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
        .manage(NotesFileLock(Mutex::new(())))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            build_tray(app)?;

            if let Some(window) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        hide_main_window(&handle);
                    }
                });

                if std::env::args().any(|arg| arg == "--hidden") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_data_path,
            load_note,
            save_notes,
            load_notes,
            upsert_note,
            patch_note,
            save_settings,
            load_settings,
            write_markdown_file,
            quit_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
