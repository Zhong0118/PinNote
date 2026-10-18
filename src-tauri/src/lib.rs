use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde_json::Value;
use tauri::{
    image::Image,
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};

struct NotesFileLock(Mutex<()>);
struct TemplatesFileLock(Mutex<()>);
struct MainNoteId(Mutex<Option<String>>);

#[derive(Default)]
struct QuitState {
    pending: HashSet<String>,
    approved: bool,
    attempt: u64,
}

impl QuitState {
    fn acknowledge(&mut self, label: &str, success: bool, attempt: u64) -> bool {
        if self.attempt != attempt || !self.pending.remove(label) {
            return false;
        }
        if !success {
            self.pending.clear();
            return false;
        }
        self.approved = self.pending.is_empty();
        self.approved
    }
}

struct QuitLock(Mutex<QuitState>);

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
    static WRITE_ID: AtomicU64 = AtomicU64::new(0);
    let tmp_path = path.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        WRITE_ID.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file =
            fs::File::create_new(&tmp_path).map_err(|e| format!("Cannot create temp file: {e}"))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Cannot write temp file: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("Cannot flush temp file: {e}"))?;
        // Rename replaces the destination atomically. Never delete the last good file on failure.
        fs::rename(&tmp_path, &path).map_err(|e| format!("Cannot replace file: {e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp_path);
    }
    result
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

fn load_templates_value(app: &AppHandle) -> Result<Value, String> {
    let path = data_file(app, "templates.json")?;
    let Some(raw) = read_optional(path)? else {
        return Ok(serde_json::json!({
            "version": 1,
            "templates": {}
        }));
    };

    serde_json::from_str(&raw).map_err(|e| format!("Cannot parse templates file: {e}"))
}

fn save_templates_value(app: &AppHandle, file: Value) -> Result<(), String> {
    atomic_write(data_file(app, "templates.json")?, file.to_string())
}

fn ensure_notes_object(file: &mut Value) {
    file["version"] = Value::from(1);
    if !file.get("notes").is_some_and(Value::is_object) {
        file["notes"] = serde_json::json!({});
    }
}

fn ensure_templates_object(file: &mut Value) {
    file["version"] = Value::from(1);
    if !file.get("templates").is_some_and(Value::is_object) {
        file["templates"] = serde_json::json!({});
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

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let menu = MenuBuilder::new(app)
        .text("show", "显示/隐藏全部便签")
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
        .icon_as_template(cfg!(target_os = "macos"))
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
                let _ = tray
                    .app_handle()
                    .emit("toggle-notes-visibility-requested", ());
            }
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                let _ = app.emit("toggle-notes-visibility-requested", ());
            }
            "new_note" => {
                let _ = app.emit("new-note-requested", ());
            }
            "settings" => {
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
fn app_data_file_path(app: AppHandle, name: String) -> Result<String, String> {
    match name.as_str() {
        "notes.json" | "settings.json" | "templates.json" | "note.json" => {
            Ok(data_file(&app, &name)?.to_string_lossy().to_string())
        }
        _ => Err("Unsupported data file".to_string()),
    }
}

#[tauri::command]
fn load_note(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(data_file(&app, "note.json")?)
}

#[tauri::command]
fn save_notes(
    app: AppHandle,
    lock: tauri::State<'_, NotesFileLock>,
    json: String,
) -> Result<(), String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Cannot lock notes file".to_string())?;
    atomic_write(data_file(&app, "notes.json")?, json)
}

#[tauri::command]
fn load_notes(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(data_file(&app, "notes.json")?)
}

#[tauri::command]
fn load_templates(app: AppHandle) -> Result<Option<String>, String> {
    read_optional(data_file(&app, "templates.json")?)
}

#[tauri::command]
fn upsert_template(
    app: AppHandle,
    lock: tauri::State<'_, TemplatesFileLock>,
    json: String,
) -> Result<String, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Cannot lock templates file".to_string())?;
    let template: Value =
        serde_json::from_str(&json).map_err(|e| format!("Cannot parse template: {e}"))?;
    let id = note_id(&template)?;
    let mut file = load_templates_value(&app)?;
    ensure_templates_object(&mut file);
    if let Some(templates) = file["templates"].as_object() {
        if !templates.contains_key(&id) && templates.len() >= 8 {
            return Err("最多只能保存 8 个自定义模板".to_string());
        }
    }
    file["templates"][&id] = template.clone();
    save_templates_value(&app, file)?;
    Ok(template.to_string())
}

#[tauri::command]
fn delete_template(
    app: AppHandle,
    lock: tauri::State<'_, TemplatesFileLock>,
    id: String,
) -> Result<(), String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Cannot lock templates file".to_string())?;
    let mut file = load_templates_value(&app)?;
    ensure_templates_object(&mut file);
    if let Some(templates) = file["templates"].as_object_mut() {
        templates.remove(&id);
    }
    save_templates_value(&app, file)
}

#[tauri::command]
fn upsert_note(
    app: AppHandle,
    lock: tauri::State<'_, NotesFileLock>,
    json: String,
    set_active: bool,
    set_closed: bool,
) -> Result<String, String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Cannot lock notes file".to_string())?;
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
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Cannot lock notes file".to_string())?;
    let patch: Value =
        serde_json::from_str(&json).map_err(|e| format!("Cannot parse note patch: {e}"))?;
    let mut file = load_notes_value(&app)?;
    ensure_notes_object(&mut file);
    if file["notes"].get(&id).is_none() {
        return Err("Note no longer exists".to_string());
    }
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
fn delete_note(
    app: AppHandle,
    lock: tauri::State<'_, NotesFileLock>,
    id: String,
) -> Result<(), String> {
    let _guard = lock
        .0
        .lock()
        .map_err(|_| "Cannot lock notes file".to_string())?;
    let mut file = load_notes_value(&app)?;
    ensure_notes_object(&mut file);

    if let Some(notes) = file["notes"].as_object_mut() {
        notes.remove(&id);
    }

    let fallback_id = file["notes"]
        .as_object()
        .and_then(|notes| notes.keys().next().cloned())
        .unwrap_or_default();

    if file["lastActiveNoteId"].as_str() == Some(id.as_str()) {
        file["lastActiveNoteId"] = Value::from(fallback_id.clone());
    }
    if file["lastClosedNoteId"].as_str() == Some(id.as_str()) {
        file["lastClosedNoteId"] = Value::from(fallback_id);
    }

    save_notes_value(&app, file)
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
fn main_note_id(state: tauri::State<'_, MainNoteId>) -> Result<Option<String>, String> {
    Ok(state
        .0
        .lock()
        .map_err(|_| "Cannot read main note".to_string())?
        .clone())
}

#[tauri::command]
fn set_main_note_id(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, MainNoteId>,
    id: Option<String>,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the main window can bind its note".to_string());
    }
    *state
        .0
        .lock()
        .map_err(|_| "Cannot bind main note".to_string())? = id;
    Ok(())
}

#[tauri::command]
fn pending_quit(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, QuitLock>,
) -> Result<Option<u64>, String> {
    let quit = state
        .0
        .lock()
        .map_err(|_| "Cannot read quit state".to_string())?;
    Ok(quit
        .pending
        .contains(window.label())
        .then_some(quit.attempt))
}

#[tauri::command]
fn quit_save_complete(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: tauri::State<'_, QuitLock>,
    success: bool,
    attempt: u64,
) -> Result<(), String> {
    let mut quit = state
        .0
        .lock()
        .map_err(|_| "Cannot lock quit state".to_string())?;
    if quit.attempt != attempt || !quit.pending.contains(window.label()) {
        return Ok(());
    }
    let exit = quit.acknowledge(window.label(), success, attempt);
    drop(quit);
    if exit {
        app.exit(0);
    } else if !success {
        let _ = app.emit("quit-save-failed", attempt);
    }
    Ok(())
}

/// macOS can interpolate a complete native frame without position/size IPC jumps.
#[tauri::command]
async fn animate_note_window(
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if ![x, y, width, height].iter().all(|v| v.is_finite()) || width < 180.0 || height < 40.0 {
        return Err("Invalid note window bounds".into());
    }
    #[cfg(target_os = "macos")]
    {
        let position = window.outer_position().map_err(|e| e.to_string())?;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        let (tx, mut rx) = tauri::async_runtime::channel(1);
        let native = window.clone();
        window
            .run_on_main_thread(move || {
                let result = (|| {
                    let pointer = native.ns_window().map_err(|e| e.to_string())?;
                    // SAFETY: Tauri owns this NSWindow, and this closure runs on its UI thread.
                    let ns_window = unsafe { &*pointer.cast::<objc2_app_kit::NSWindow>() };
                    let mut frame = ns_window.frame();
                    frame.origin.x += x - f64::from(position.x) / scale;
                    // Cocoa's origin is bottom-left; keep the requested desktop top edge.
                    frame.origin.y +=
                        frame.size.height - height - (y - f64::from(position.y) / scale);
                    frame.size.width = width;
                    frame.size.height = height;
                    use objc2_app_kit::{NSAnimatablePropertyContainer, NSAnimationContext};
                    // Yield the AppKit run loop during resizing so WKWebView can repaint
                    // every intermediate frame instead of jumping at the animation end.
                    let animator = ns_window.animator();
                    NSAnimationContext::beginGrouping();
                    let context = NSAnimationContext::currentContext();
                    context.setDuration(0.24);
                    let finished = tx.clone();
                    context.setCompletionHandler(Some(&block2::RcBlock::new(move || {
                        let _ = finished.try_send(Ok(()));
                    })));
                    animator.setFrame_display(frame, true);
                    NSAnimationContext::endGrouping();
                    Ok(())
                })();
                if let Err(error) = result {
                    let _ = tx.try_send(Err(error));
                }
            })
            .map_err(|e| e.to_string())?;
        rx.recv()
            .await
            .ok_or_else(|| "Window animation was interrupted".to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn startup_hidden() -> bool {
    std::env::args().any(|arg| arg == "--hidden")
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    let autostart = tauri_plugin_autostart::Builder::new()
        .app_name("PinNote")
        .args(["--hidden"])
        .macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);

    #[cfg(not(target_os = "macos"))]
    let autostart = tauri_plugin_autostart::Builder::new()
        .app_name("PinNote")
        .args(["--hidden"]);

    tauri::Builder::default()
        .manage(NotesFileLock(Mutex::new(())))
        .manage(TemplatesFileLock(Mutex::new(())))
        .manage(MainNoteId(Mutex::new(None)))
        .manage(QuitLock(Mutex::new(QuitState::default())))
        .plugin(autostart.build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .on_window_event(|window, event| {
            if matches!(event, WindowEvent::Destroyed) {
                let state = window.state::<QuitLock>();
                let mut quit = state.0.lock().expect("quit state poisoned");
                let attempt = quit.attempt;
                let exit = quit.acknowledge(window.label(), true, attempt);
                drop(quit);
                if exit {
                    window.app_handle().exit(0);
                }
            }
        })
        .setup(|app| {
            build_tray(app)?;

            if let Some(window) = app.get_webview_window("main") {
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        // The frontend saves before hiding. Hiding here races that write.
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
            app_data_file_path,
            load_note,
            save_notes,
            load_notes,
            load_templates,
            upsert_template,
            delete_template,
            upsert_note,
            patch_note,
            delete_note,
            save_settings,
            load_settings,
            write_markdown_file,
            quit_app,
            main_note_id,
            set_main_note_id,
            quit_save_complete,
            pending_quit,
            startup_hidden,
            animate_note_window
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { api, .. } = event {
                let state = app.state::<QuitLock>();
                let mut quit = state.0.lock().expect("quit state poisoned");
                if quit.approved {
                    return;
                }
                api.prevent_exit();
                if !quit.pending.is_empty() {
                    return;
                }
                quit.attempt += 1;
                let attempt = quit.attempt;
                quit.pending = app
                    .webview_windows()
                    .keys()
                    .filter(|label| label.as_str() == "main" || label.starts_with("note-"))
                    .cloned()
                    .collect();
                if quit.pending.is_empty() {
                    quit.approved = true;
                    drop(quit);
                    app.exit(0);
                } else {
                    drop(quit);
                    if app.emit("save-before-quit", attempt).is_err() {
                        state.0.lock().expect("quit state poisoned").pending.clear();
                        let _ = app.emit("quit-save-failed", attempt);
                    }
                }
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};

    #[test]
    fn previous_attempt_cannot_acknowledge_a_new_quit() {
        let mut quit = QuitState {
            pending: HashSet::from(["main".into()]),
            approved: false,
            attempt: 2,
        };
        assert!(!quit.acknowledge("main", true, 1));
        assert_eq!(quit.pending.len(), 1);
        assert!(quit.acknowledge("main", true, 2));
    }

    #[test]
    fn quit_waits_for_every_window_and_ignores_duplicate_acknowledgements() {
        let mut quit = QuitState {
            pending: HashSet::from(["main".into(), "note-b".into()]),
            approved: false,
            attempt: 1,
        };
        assert!(!quit.acknowledge("main", true, 1));
        assert!(!quit.acknowledge("main", true, 1));
        assert!(quit.acknowledge("note-b", true, 1));
        assert!(quit.approved);
    }

    #[test]
    fn failed_save_cancels_quit_even_if_other_windows_report_success() {
        let mut quit = QuitState {
            pending: HashSet::from(["main".into(), "note-b".into()]),
            approved: false,
            attempt: 1,
        };
        assert!(!quit.acknowledge("main", false, 1));
        assert!(!quit.acknowledge("note-b", true, 1));
        assert!(!quit.approved);
        assert!(quit.pending.is_empty());
    }

    #[test]
    fn concurrent_writes_always_publish_a_complete_file() {
        let dir = std::env::temp_dir().join(format!("pinnote-write-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let barrier = Arc::new(Barrier::new(12));
        let workers: Vec<_> = (0..12)
            .map(|i| {
                let path = path.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    for _ in 0..20 {
                        atomic_write(
                            path.clone(),
                            serde_json::json!({"writer": i, "text": "x".repeat(1000)}).to_string(),
                        )?;
                    }
                    Ok::<_, String>(())
                })
            })
            .collect();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        let content = fs::read_to_string(&path).unwrap();
        fs::remove_dir_all(&dir).unwrap();
        assert!(results.iter().all(Result::is_ok), "{results:?}");
        let value: Value = serde_json::from_str(&content).unwrap();
        assert_eq!(value["text"].as_str().unwrap().len(), 1000);
    }
}
