//! Whole-library safety: automatic daily copies of `notes.json`, restore from a copy,
//! export of every note as Markdown files, and hiding windows from screen capture.
use crate::{atomic_write, data_dir, data_file, notes, NotesFileLock};
use serde_json::{json, Value};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

const KEEP_DAILY: usize = 14;
const KEEP_BEFORE_RESTORE: usize = 3;
const DAILY: u64 = 20 * 3600 * 1000;
const RESTORE_SUFFIX: &str = "-before-restore";

/// A backup file name: `notes-<ms>.json` or `notes-<ms>-before-restore.json`.
pub fn parse_name(name: &str) -> Option<(u64, bool)> {
    let stem = name.strip_prefix("notes-")?.strip_suffix(".json")?;
    let (digits, restore) = match stem.strip_suffix(RESTORE_SUFFIX) {
        Some(digits) => (digits, true),
        None => (stem, false),
    };
    (!digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()))
        .then(|| digits.parse().ok())
        .flatten()
        .map(|at| (at, restore))
}

/// Names to delete so that only the newest copies of each kind remain.
pub fn surplus(mut names: Vec<String>) -> Vec<String> {
    names.sort_by_key(|n| std::cmp::Reverse(parse_name(n).map_or(0, |(at, _)| at)));
    let (mut daily, mut restore) = (0, 0);
    names
        .into_iter()
        .filter(|name| match parse_name(name) {
            Some((_, true)) => {
                restore += 1;
                restore > KEEP_BEFORE_RESTORE
            }
            Some((_, false)) => {
                daily += 1;
                daily > KEEP_DAILY
            }
            None => false,
        })
        .collect()
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = data_dir(app)?.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建备份目录：{e}"))?;
    Ok(dir)
}

fn names(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|entries| {
            entries
                .filter_map(|e| e.ok()?.file_name().into_string().ok())
                .filter(|n| parse_name(n).is_some())
                .collect()
        })
        .unwrap_or_default()
}

/// Copy `notes.json` unless an unchanged or recent (`force`: identical only) copy exists.
/// Must be called with the notes lock held. Returns the new file name.
fn snapshot(app: &AppHandle, force: bool, suffix: &str) -> Result<Option<String>, String> {
    let Some(raw) = crate::read_optional(data_file(app, "notes.json")?)? else {
        return Ok(None);
    };
    let dir = folder(app)?;
    let mut existing = names(&dir);
    existing.sort_by_key(|n| parse_name(n).map_or(0, |(at, _)| at));
    let now = notes::now();
    if let Some(newest) = existing.last() {
        let at = parse_name(newest).map_or(0, |(at, _)| at);
        if suffix.is_empty() && !force && now.saturating_sub(at) < DAILY {
            return Ok(None);
        }
        if suffix.is_empty() && std::fs::read_to_string(dir.join(newest)).is_ok_and(|old| old == raw) {
            return Ok(None);
        }
    }
    let name = format!("notes-{now}{suffix}.json");
    atomic_write(dir.join(&name), raw)?;
    for old in surplus(names(&dir)) {
        let _ = std::fs::remove_file(dir.join(old));
    }
    Ok(Some(name))
}

/// Hourly check; a copy is made at most once every 20 hours and only when something changed.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(30)).await;
        loop {
            {
                let state = app.state::<NotesFileLock>();
                let guard = state.0.lock();
                if guard.is_ok() {
                    let _ = snapshot(&app, false, "");
                }
                drop(guard);
            }
            // After the backup, so whatever is emptied from the trash is still in it.
            let _ = notes::empty_expired_trash(&app);
            tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        }
    });
}

#[tauri::command]
pub fn backup_now(app: AppHandle) -> Result<Option<String>, String> {
    let state = app.state::<NotesFileLock>();
    let _guard = state.0.lock().map_err(|_| "Cannot lock notes")?;
    snapshot(&app, true, "")
}

/// Backups, newest first, with how many notes (not counting the trash) each holds.
#[tauri::command]
pub fn list_backups(app: AppHandle) -> Result<Value, String> {
    let dir = folder(&app)?;
    let mut list: Vec<Value> = names(&dir)
        .into_iter()
        .filter_map(|name| {
            let (at, restore) = parse_name(&name)?;
            let raw = std::fs::read_to_string(dir.join(&name)).ok()?;
            let file: Value = serde_json::from_str(&raw).ok()?;
            let count = file["notes"]
                .as_object()
                .map_or(0, |n| n.values().filter(|n| n["lifecycle"] != "trash").count());
            Some(json!({"name":name,"at":at,"beforeRestore":restore,"size":raw.len(),"notes":count}))
        })
        .collect();
    list.sort_by_key(|b| std::cmp::Reverse(b["at"].as_u64()));
    Ok(json!(list))
}

/// Replace the library with a backup. Every editor saves first (as before an update); the
/// current library is kept as a "before restore" copy; then the app restarts on the backup.
#[tauri::command]
pub async fn restore_backup(app: AppHandle, name: String) -> Result<(), String> {
    if parse_name(&name).is_none() {
        return Err("备份文件名无效".into());
    }
    let raw = std::fs::read_to_string(folder(&app)?.join(&name)).map_err(|e| format!("无法读取备份：{e}"))?;
    let mut parsed: Value = serde_json::from_str(&raw).map_err(|_| "备份文件已损坏，未恢复")?;
    notes::normalize(&mut parsed)?;
    let attempt = crate::prepare_update(&app)
        .await
        .map_err(|_| "便签尚未全部保存，已取消恢复。请重试".to_string())?;
    let replaced = (|| {
        let state = app.state::<NotesFileLock>();
        let _guard = state.0.lock().map_err(|_| "Cannot lock notes")?;
        snapshot(&app, true, RESTORE_SUFFIX)?;
        atomic_write(data_file(&app, "notes.json")?, raw)?;
        notes::forget();
        Ok::<(), String>(())
    })();
    match replaced {
        Ok(()) => app.restart(),
        Err(error) => {
            crate::resume_after_update(&app, attempt);
            Err(error)
        }
    }
}

/// A path inside the export folder: plain relative components only.
fn safe_relative(path: &str) -> Option<PathBuf> {
    let rel = Path::new(path);
    let ok = !path.is_empty()
        && rel.components().all(|c| matches!(c, Component::Normal(_)))
        && !path.contains('\\')
        && !path.contains(':');
    ok.then(|| rel.to_path_buf())
}

/// Write the Markdown files the center prepared into a new folder inside `dir`,
/// copying any local `assets/<file>` images referenced by the notes alongside them.
#[tauri::command]
pub fn export_notes(app: AppHandle, dir: String, folder: String, files: Vec<Value>) -> Result<String, String> {
    let name = safe_relative(&folder)
        .filter(|p| p.components().count() == 1)
        .ok_or("导出文件夹名无效")?;
    let base = PathBuf::from(dir).join(name);
    std::fs::create_dir(&base).map_err(|e| format!("无法创建导出文件夹：{e}"))?;
    for file in files {
        let rel = file["path"].as_str().and_then(safe_relative).ok_or("导出文件名无效")?;
        let target = base.join(rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("无法创建文件夹：{e}"))?;
        }
        let body = file["content"].as_str().unwrap_or("");
        use std::io::Write;
        std::fs::File::create_new(&target)
            .and_then(|mut f| f.write_all(body.as_bytes()))
            .map_err(|e| format!("无法写入 {}：{e}", target.display()))?;
        if let Some(parent) = target.parent() {
            copy_referenced_assets(&app, body, parent);
        }
    }
    Ok(base.to_string_lossy().to_string())
}

pub fn asset_mime(name: &str) -> Option<&'static str> {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())?;
    match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

pub fn resolve_asset_file(app: &AppHandle, name: &str) -> Option<(PathBuf, &'static str)> {
    let clean = safe_relative(name).filter(|p| p.components().count() == 1)?;
    let mime = asset_mime(name)?;
    let path = data_dir(app).ok()?.join("assets").join(clean);
    path.is_file().then_some((path, mime))
}

/// Extract safe `assets/<filename>` names referenced in Markdown text.
pub fn extract_asset_names(markdown: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut rest = markdown;
    while let Some(pos) = rest.find("assets/") {
        let after = &rest[pos + "assets/".len()..];
        let end = after
            .find(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '-' | '_' | '.'))
            .unwrap_or(after.len());
        let candidate = &after[..end];
        if !candidate.is_empty()
            && safe_relative(candidate).is_some_and(|p| p.components().count() == 1)
            && asset_mime(candidate).is_some()
            && !names.iter().any(|n| n == candidate)
        {
            names.push(candidate.to_string());
        }
        rest = &after[end..];
    }
    names
}

pub fn copy_referenced_assets(app: &AppHandle, markdown: &str, target_dir: &Path) {
    let names = extract_asset_names(markdown);
    if names.is_empty() {
        return;
    }
    let dest_dir = target_dir.join("assets");
    for name in names {
        if let Some((src, _)) = resolve_asset_file(app, &name) {
            if std::fs::create_dir_all(&dest_dir).is_ok() {
                let dst = dest_dir.join(&name);
                if !dst.exists() {
                    let _ = std::fs::copy(src, dst);
                }
            }
        }
    }
}

#[tauri::command]
pub fn save_note_image(app: AppHandle, ext: String, bytes: Vec<u8>) -> Result<String, String> {
    let clean_ext = ext.trim().trim_start_matches('.').to_ascii_lowercase();
    let normalized = match clean_ext.as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        "gif" => "gif",
        _ => return Err("仅支持 png / jpg / webp / gif 图片".into()),
    };
    if bytes.is_empty() {
        return Err("图片数据为空".into());
    }
    if bytes.len() > 10 * 1024 * 1024 {
        return Err("图片超过 10 MB 上限".into());
    }
    let dir = data_dir(&app)?.join("assets");
    std::fs::create_dir_all(&dir).map_err(|e| format!("无法创建图片目录：{e}"))?;
    let filename = format!("{}.{normalized}", uuid::Uuid::new_v4());
    let path = dir.join(&filename);
    std::fs::write(&path, bytes).map_err(|e| format!("无法保存图片：{e}"))?;
    Ok(format!("assets/{filename}"))
}

#[tauri::command]
pub fn import_image_file(app: AppHandle, path: String) -> Result<String, String> {
    let src = PathBuf::from(&path);
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_string();
    let meta = std::fs::metadata(&src).map_err(|e| format!("无法读取图片：{e}"))?;
    if meta.len() > 10 * 1024 * 1024 {
        return Err("图片超过 10 MB 上限".into());
    }
    let bytes = std::fs::read(&src).map_err(|e| format!("无法读取图片：{e}"))?;
    save_note_image(app, ext, bytes)
}

static HIDE_FROM_CAPTURE: AtomicBool = AtomicBool::new(false);

pub fn is_capture_protected() -> bool {
    HIDE_FROM_CAPTURE.load(Ordering::Relaxed)
}

/// Ask the system to keep PinNote windows out of screenshots and screen sharing. Windows
/// honours this; on macOS some capture tools may still record them.
#[tauri::command]
pub fn set_capture_protection(app: AppHandle, enabled: bool) {
    HIDE_FROM_CAPTURE.store(enabled, Ordering::Relaxed);
    for window in app.webview_windows().values() {
        let _ = window.set_content_protected(enabled);
    }
    crate::refresh_tray_now(&app);
}

/// Windows created later (desktop notes, previews, the handle) follow the setting too.
pub fn protect_new(webview: &tauri::Webview) {
    if HIDE_FROM_CAPTURE.load(Ordering::Relaxed) {
        let _ = webview.window().set_content_protected(true);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backup_names_are_strict() {
        assert_eq!(parse_name("notes-12.json"), Some((12, false)));
        assert_eq!(parse_name("notes-12-before-restore.json"), Some((12, true)));
        assert_eq!(parse_name("notes-.json"), None);
        assert_eq!(parse_name("../notes-12.json"), None);
        assert_eq!(parse_name("notes-1a.json"), None);
    }
    #[test]
    fn only_the_newest_copies_of_each_kind_are_kept() {
        let mut names: Vec<String> = (1..=20).map(|i| format!("notes-{i}.json")).collect();
        names.extend((1..=5).map(|i| format!("notes-{i}-before-restore.json")));
        let gone = surplus(names);
        assert_eq!(gone.len(), 6 + 2);
        assert!(gone.contains(&"notes-1.json".to_string()) && !gone.contains(&"notes-20.json".to_string()));
        assert!(gone.contains(&"notes-1-before-restore.json".to_string()));
    }
    #[test]
    fn export_paths_cannot_escape_the_folder() {
        assert!(safe_relative("归档/读书.md").is_some());
        for bad in ["", "../x.md", "/etc/x", "a/../../x", "C:x.md", "a\\b.md"] {
            assert!(safe_relative(bad).is_none(), "{bad}");
        }
    }
    #[test]
    fn extracts_only_safe_image_asset_references() {
        let md = "![图1](assets/abc-123.png) 与 ![重复](assets/abc-123.png) 以及 ![非法](assets/../secret.png) 和 ![非图](assets/doc.txt) 和 ![图2](assets/shot_2.webp)";
        assert_eq!(
            extract_asset_names(md),
            vec!["abc-123.png".to_string(), "shot_2.webp".to_string()]
        );
    }
}
